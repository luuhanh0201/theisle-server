-- ZoneGuard — small dinos only, in the zones the admin marks (panel → Bản đồ
-- → Dino nhỏ): the AI zones ticked "Chỉ dino nhỏ" and the sanctuaries ticked
-- there. The bridge writes every guarded shape and the rules to
-- Mods/ZoneGuard/Saved/guard.json (bridge/src/zone-guard.ts).
--
-- A player's dino inside one, grown past its species' limit (GetGrowth, 0–1;
-- `max[species]`, else `defaultMax`):
--   * is warned once (a server message, text in the panel's Thông báo)
--   * `grace` seconds later, still inside, is stung: every `every` seconds it
--     loses `pct`% of its maximum health (GetHealth / GetMaxHealth, then
--     SetHealth — as the garage and !slay use it), like the bees of the
--     game's own sanctuaries. Staying kills it; leaving stops it.
--   * stepping out and back in within REENTER_S keeps its clock — no fresh
--     grace for a dino that just walked out of the stings
--
-- Safety (docs/lua-safety-rules.md): all on the game thread (H.every), every
-- pawn re-resolved from its controller each tick (nothing kept but SteamIDs),
-- every engine call in pcall, numbers and the class name only.

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end

local H    = require("shared.isle.helpers")
local json = require("shared.isle.json")
local Msg  = require("shared.isle.messages")

local MOD = "ZoneGuard"
local RULES_PATH = "Mods/ZoneGuard/Saved/guard.json"
local TICK_MS = 1000
local RELOAD_S = 5
local REENTER_S = 60

--------------------------------------------------------------------------
-- Rules (written by the bridge; read at most every RELOAD_S)
--------------------------------------------------------------------------

local OFF = { enabled = false, zones = {} }
local rules, rulesAt = OFF, nil

local function num(v, lo, hi, default)
    local n = tonumber(v)
    if n == nil then return default end
    return math.max(lo, math.min(hi, n))
end

local function readRules()
    local now = os.time()
    if rulesAt ~= nil and now - rulesAt < RELOAD_S then return rules end
    rulesAt = now
    local f = io.open(RULES_PATH, "r")
    if not f then rules = OFF; return rules end
    local raw = f:read("*a")
    f:close()
    local ok, d = pcall(json.decode, raw or "")
    if not ok or type(d) ~= "table" then return rules end   -- a torn file: keep the last
    local zones = {}
    for _, z in ipairs(type(d.zones) == "table" and d.zones or {}) do
        if type(z) == "table" and tonumber(z.x) and tonumber(z.y) and tonumber(z.radius) then
            local poly = nil
            if type(z.poly) == "table" and #z.poly >= 3 then poly = z.poly end
            zones[#zones + 1] = { name = tostring(z.name or "?"), x = tonumber(z.x), y = tonumber(z.y),
                radius = tonumber(z.radius), poly = poly }
        end
    end
    local max = {}
    for k, v in pairs(type(d.max) == "table" and d.max or {}) do
        if tonumber(v) then max[tostring(k)] = num(v, 0.01, 1, 1) end
    end
    rules = {
        enabled = d.enabled == true and #zones > 0,
        grace = num(d.grace, 0, 600, 30),
        every = num(d.every, 1, 60, 5),
        pct = num(d.pct, 1, 100, 5),
        defaultMax = num(d.defaultMax, 0.01, 1, 0.5),
        max = max,
        zones = zones,
    }
    return rules
end

--------------------------------------------------------------------------
-- Shapes
--------------------------------------------------------------------------

local function inPoly(poly, x, y)
    local inside = false
    local j = #poly
    for i = 1, #poly do
        local xi, yi = tonumber(poly[i][1]), tonumber(poly[i][2])
        local xj, yj = tonumber(poly[j][1]), tonumber(poly[j][2])
        if xi and yi and xj and yj and ((yi > y) ~= (yj > y)) and x < (xj - xi) * (y - yi) / (yj - yi) + xi then
            inside = not inside
        end
        j = i
    end
    return inside
end

--- The first guarded zone the point is in, or nil.
local function zoneAt(r, x, y)
    for _, z in ipairs(r.zones) do
        local dx, dy = x - z.x, y - z.y
        if dx * dx + dy * dy <= z.radius * z.radius and (z.poly == nil or inPoly(z.poly, x, y)) then return z end
    end
    return nil
end

--------------------------------------------------------------------------
-- Reading and stinging (game thread)
--------------------------------------------------------------------------

local function call(pawn, fn)
    local ok, v = pcall(function() return pawn[fn](pawn) end)
    return ok and type(v) == "number" and v or nil
end

--- "BP_Carnotaurus_C" -> "Carnotaurus"
local function speciesOf(pawn)
    local ok, n = pcall(function() return pawn:GetClass():GetFName():ToString() end)
    if not ok or n == nil then return nil end
    local cls = tostring(n):match("([%w_]+)$") or tostring(n)
    return (cls:gsub("^BP_", ""):gsub("_C$", ""))
end

local function locOf(pawn)
    local ok, v = pcall(function() return pawn:K2_GetActorLocation() end)
    if ok and v and type(v.X) == "number" then return v.X, v.Y end
    return nil
end

--- One sting: `pct`% of the maximum health off. The health left, or nil.
local function sting(pawn, pct)
    local hp, mx = call(pawn, "GetHealth"), call(pawn, "GetMaxHealth")
    if hp == nil or mx == nil or mx <= 0 or hp <= 0 then return nil end
    local left = math.max(0, hp - mx * pct / 100)
    if not pcall(function() pawn:SetHealth(left) end) then return nil end
    return left
end

local pctText = function(g) return tostring(math.floor(g * 100 + 0.5)) end

--------------------------------------------------------------------------
-- The tick
--------------------------------------------------------------------------

local state = {}   -- SteamID -> { zone, since (warned at), stungAt, leftAt }

local function tick()
    local r = readRules()
    if not r.enabled then state = {}; return end
    local now = os.time()
    local seen = {}
    H.forEachPlayer(function(ctrl)
        local id = H.safeSteamId(ctrl)
        local pawn = id and H.livePawnFromCtrl(ctrl)
        if not pawn then return end
        seen[id] = true
        local st = state[id]
        local g = call(pawn, "GetGrowth")
        local sp = speciesOf(pawn)
        local limit = (sp and r.max[sp]) or r.defaultMax
        local zone = nil
        if g and g > limit + 0.001 then
            local x, y = locOf(pawn)
            if x then zone = zoneAt(r, x, y) end
        end
        if zone == nil then
            if st then
                st.leftAt = st.leftAt or now
                if now - st.leftAt > REENTER_S then state[id] = nil end
            end
            return
        end
        if st == nil or (st.leftAt and now - st.leftAt > REENTER_S) then
            state[id] = { zone = zone.name, since = now }
            Msg.notify(ctrl, "guard.warn",
                "Dino của bạn quá lớn cho “{zone}” ({growth}% — tối đa {max}%). Rời khỏi trong {seconds} giây, nếu không sẽ bị ong đốt!",
                { zone = zone.name, growth = pctText(g), max = pctText(limit), seconds = math.floor(r.grace) })
            H.log(string.format("%s: %s (%s %s%%) entered %s — warned", MOD, id, tostring(sp), pctText(g), zone.name))
            return
        end
        st.leftAt = nil
        st.zone = zone.name
        if now - st.since < r.grace then return end
        if st.stungAt and now - st.stungAt < r.every then return end
        local left = sting(pawn, r.pct)
        if left == nil then return end
        if not st.stungAt then
            Msg.notify(ctrl, "guard.sting", "Bạn đang bị ong đốt ở “{zone}” — mất {pct}% máu mỗi {every} giây cho tới khi rời đi.",
                { zone = zone.name, pct = math.floor(r.pct), every = math.floor(r.every) })
            H.log(string.format("%s: %s (%s) stung in %s", MOD, id, tostring(sp), zone.name))
        end
        st.stungAt = now
        if left <= 0 then
            H.log(string.format("%s: %s (%s) died of the stings in %s", MOD, id, tostring(sp), zone.name))
            state[id] = nil
        end
    end)
    for id in pairs(state) do
        if not seen[id] then state[id] = nil end
    end
end

H.every(TICK_MS, MOD .. " tick", tick)
H.log(MOD .. ": loaded — rules from " .. RULES_PATH)
