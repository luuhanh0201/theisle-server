--[[
    PlayerCommands — chat commands for players.

        !slay      kill your current dino (cooldown)
        !unstuck   move back to the last spot you stood on the GROUND, a few
                   metres from here (cooldown). Never from a height: the spots
                   are recorded only while the dino is walking on the ground.
        !prime     is this dino a prime elder / eligible for prime
        !status    growth and vitals of your current dino

    Settings (panel → Server → Cấu hình game → Lệnh người chơi) are read fresh
    from Mods/PlayerCommands/Saved/settings.json on every command.

    Safety (docs/lua-safety-rules.md): chat handlers already run outside the
    hook on the game thread (H.onChat); the ground tracker reads pawns only
    through H.onGameThread; every engine call is pcall-wrapped; controllers and
    pawns are re-resolved each time, only SteamIDs are kept.
]]

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end

local H    = require("shared.isle.helpers")
local json = require("shared.isle.json")

local MOD = "PlayerCommands"
local SETTINGS_PATH = "Mods/PlayerCommands/Saved/settings.json"

local DEFAULTS = {
    slayCooldown    = 300,     -- seconds between two !slay by one player
    unstuckCooldown = 600,     -- seconds between two !unstuck
    enabled = { slay = true, unstuck = true, prime = true, status = true },
}

local TRACK_MS       = 3000    -- how often ground spots are sampled
local TRACK_KEEP     = 40      -- spots kept per player (~2 minutes)
local TRACK_MIN_STEP = 150     -- only record a spot 1.5 m from the previous one
local UNSTUCK_MIN_AWAY = 300   -- the target must be at least 3 m from here
local UNSTUCK_MIN_AGE  = 5     -- ...and at least 5 s old (not "where I am stuck")
local UNSTUCK_LIFT     = 50    -- 0.5 m above the recorded ground point

--------------------------------------------------------------------------
-- Settings
--------------------------------------------------------------------------

local function readSettings()
    local s = { slayCooldown = DEFAULTS.slayCooldown, unstuckCooldown = DEFAULTS.unstuckCooldown, enabled = {} }
    for k, v in pairs(DEFAULTS.enabled) do s.enabled[k] = v end
    local f = io.open(SETTINGS_PATH, "r")
    if not f then return s end
    local raw = f:read("*a")
    f:close()
    local ok, data = pcall(json.decode, raw)
    if not ok or type(data) ~= "table" then return s end
    for _, key in ipairs({ "slayCooldown", "unstuckCooldown" }) do
        local n = tonumber(data[key])
        if n and n >= 0 and n <= 86400 then s[key] = math.floor(n) end
    end
    if type(data.enabled) == "table" then
        for k in pairs(DEFAULTS.enabled) do
            if type(data.enabled[k]) == "boolean" then s.enabled[k] = data.enabled[k] end
        end
    end
    return s
end

--------------------------------------------------------------------------
-- Cooldowns (in memory: a server restart resets them)
--------------------------------------------------------------------------

local lastUse = { slay = {}, unstuck = {} }

--- nil if allowed now, else the seconds left.
local function cooldownLeft(cmd, steamId, seconds)
    local at = lastUse[cmd][steamId]
    if at == nil then return nil end
    local left = at + seconds - os.time()
    if left > 0 then return left end
    return nil
end

local function fmtWait(sec)
    if sec >= 60 then return string.format("%d phút %d giây", sec // 60, sec % 60) end
    return string.format("%d giây", sec)
end

--------------------------------------------------------------------------
-- Ground spots for !unstuck
--------------------------------------------------------------------------

local spots = {}   -- steamId -> { {x,y,z,t}, ... } newest last

local function isOnGround(pawn)
    local ok, ground = pcall(function()
        local move = pawn.CharacterMovement
        if not H.isValid(move) then return false end
        return move:IsMovingOnGround() == true and move:IsSwimming() ~= true and move:IsFalling() ~= true
    end)
    return ok and ground == true
end

local function locationOf(pawn)
    local ok, loc = pcall(function() return pawn:K2_GetActorLocation() end)
    if not ok or loc == nil then return nil end
    local x, y, z = tonumber(loc.X), tonumber(loc.Y), tonumber(loc.Z)
    if not (x and y and z) then return nil end
    return { x = x, y = y, z = z }
end

local function dist(a, b)
    local dx, dy, dz = a.x - b.x, a.y - b.y, a.z - b.z
    return math.sqrt(dx * dx + dy * dy + dz * dz)
end

local function recordSpots()
    local now = os.time()
    local seen = {}
    H.forEachPlayer(function(ctrl)
        local id = H.safeSteamId(ctrl)
        if not id then return end
        seen[id] = true
        local pawn = H.livePawnFromCtrl(ctrl)
        if not pawn or not isOnGround(pawn) then return end
        local here = locationOf(pawn)
        if not here then return end
        local list = spots[id] or {}
        local last = list[#list]
        if last == nil or dist(last, here) >= TRACK_MIN_STEP then
            here.t = now
            list[#list + 1] = here
            if #list > TRACK_KEEP then table.remove(list, 1) end
        end
        spots[id] = list
    end)
    for id in pairs(spots) do
        if not seen[id] then spots[id] = nil end   -- left the server
    end
end

--- The newest recorded ground spot that is old enough and far enough away.
local function unstuckTarget(steamId, here)
    local list = spots[steamId] or {}
    local now = os.time()
    for i = #list, 1, -1 do
        local s = list[i]
        if now - s.t >= UNSTUCK_MIN_AGE and dist(s, here) >= UNSTUCK_MIN_AWAY then return s end
    end
    return nil
end

--------------------------------------------------------------------------
-- Commands
--------------------------------------------------------------------------

local function doSlay(ctrl, steamId, settings)
    local left = cooldownLeft("slay", steamId, settings.slayCooldown)
    if left then
        H.safeNotify(ctrl, "!slay: chờ thêm " .. fmtWait(left) .. ".")
        return
    end
    local pawn = H.livePawnFromCtrl(ctrl)
    if not pawn then
        H.safeNotify(ctrl, "!slay: bạn chưa điều khiển dino nào.")
        return
    end
    if H.try(MOD .. ": slay SetHealth(0)", function() pawn:SetHealth(0) end) then
        lastUse.slay[steamId] = os.time()
        H.safeNotify(ctrl, "Dino của bạn đã chết. Chọn loài để spawn lại.")
    else
        H.safeNotify(ctrl, "!slay không thực hiện được, thử lại sau.")
    end
end

local function doUnstuck(ctrl, steamId, settings)
    local left = cooldownLeft("unstuck", steamId, settings.unstuckCooldown)
    if left then
        H.safeNotify(ctrl, "!unstuck: chờ thêm " .. fmtWait(left) .. ".")
        return
    end
    local pawn = H.livePawnFromCtrl(ctrl)
    if not pawn then
        H.safeNotify(ctrl, "!unstuck: bạn chưa điều khiển dino nào.")
        return
    end
    local here = locationOf(pawn)
    local target = here and unstuckTarget(steamId, here)
    if not target then
        H.safeNotify(ctrl, "!unstuck: chưa có điểm an toàn trên mặt đất — đi bộ trên mặt đất vài giây rồi thử lại.")
        return
    end
    local ok, moved = H.try(MOD .. ": unstuck K2_SetActorLocation", function()
        return pawn:K2_SetActorLocation({ X = target.x, Y = target.y, Z = target.z + UNSTUCK_LIFT }, false, {}, true)
    end)
    if ok and moved ~= false then
        lastUse.unstuck[steamId] = os.time()
        H.safeNotify(ctrl, string.format("Đã đưa bạn về điểm an toàn cách %.0f m.", dist(here, target) / 100))
    else
        H.safeNotify(ctrl, "!unstuck không thực hiện được, thử lại sau.")
    end
end

local function callBool(pawn, fn)
    local ok, v = pcall(function() return pawn[fn](pawn) end)
    if ok and type(v) == "boolean" then return v end
    return nil
end

local function yesNo(v)
    if v == nil then return "không rõ" end
    return v and "có" or "không"
end

local function doPrime(ctrl)
    local pawn = H.livePawnFromCtrl(ctrl)
    if not pawn then
        H.safeNotify(ctrl, "!prime: bạn chưa điều khiển dino nào.")
        return
    end
    local isPrime = callBool(pawn, "IsPrimeElder")
    local eligible = callBool(pawn, "GetIsEligiblePrimeElder")
    H.safeNotify(ctrl, string.format("Prime elder: %s · Đủ điều kiện lên prime: %s.", yesNo(isPrime), yesNo(eligible)))
end

local VITALS = {
    { "Máu",     "health",  "GetHealth",  "GetMaxHealth" },
    { "Stamina", "stamina", "GetStamina", "GetMaxStamina" },
    { "Đói",     "hunger",  "GetHunger",  "GetMaxHunger" },
    { "Khát",    "thirst",  "GetThirst",  "GetMaxThirst" },
    { "Huyết",   "blood",   "GetBlood",   "GetMaxBlood" },
    { "Oxy",     "oxygen",  "GetOxygen",  "GetMaxOxygen" },
}

local function doStatus(ctrl)
    local pawn = H.livePawnFromCtrl(ctrl)
    if not pawn then
        H.safeNotify(ctrl, "!status: bạn chưa điều khiển dino nào.")
        return
    end
    local okS, species = pcall(function() return pawn:GetClass():GetFName():ToString() end)
    species = okS and tostring(species):gsub("^BP_", ""):gsub("_C$", "") or "?"
    local growth = H.readVital(pawn, "GetGrowth", { "Growth" }, "growth")
    local parts = { string.format("%s · growth %s", species, growth and string.format("%.0f%%", growth * 100) or "?") }
    for _, v in ipairs(VITALS) do
        local cur = H.readVital(pawn, v[3], {}, v[2])
        if cur ~= nil then
            local okM, max = pcall(function() return pawn[v[4]](pawn) end)
            if okM and type(max) == "number" and max > 0 then
                parts[#parts + 1] = string.format("%s %.0f/%.0f", v[1], cur, max)
            else
                parts[#parts + 1] = string.format("%s %.0f", v[1], cur)
            end
        end
    end
    H.safeNotify(ctrl, table.concat(parts, " · "))
end

local COMMANDS = { slay = doSlay, unstuck = doUnstuck, prime = doPrime, status = doStatus }

H.onChat(function(ctrl, steamId, msg)
    local cmd = H.parseCommand(msg)
    local handler = cmd and COMMANDS[cmd]
    if not handler then return end
    local settings = readSettings()
    if settings.enabled[cmd] == false then
        H.safeNotify(ctrl, "!" .. cmd .. " đang bị tắt trên server này.")
        return
    end
    handler(ctrl, steamId, settings)
end)

-- Ground tracker: the loop only schedules; the reads run on the game thread.
local busy = false
LoopAsync(TRACK_MS, function()
    if not busy then
        busy = H.onGameThread(MOD .. ": ground spots", function()
            busy = false
            H.try(MOD .. ": record spots", recordSpots)
        end)
    end
    return false
end)

H.log(MOD .. ": loaded")
