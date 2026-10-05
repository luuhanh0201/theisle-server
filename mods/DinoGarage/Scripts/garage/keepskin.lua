--[[
    DinoGarage/keepskin.lua

    Colours a player keeps from the web skin editor ("giữ màu cho lần chơi
    sau"): painted again on every new dino of that species they play, a new
    life, a relog, after a server restart.

        Saved/skins.json   written by the bridge (bridge/src/kept-skins.ts):
            { "players": { "<steamId>": { "BP_Deinosuchus_C": {
                  colors = { Body = {r,g,b}, … } (linear), pattern, theme, variation } } } }

    A dino is looked at once, DELAY_S after it first shows up (the game paints
    it itself first). Skipped: a dino the garage just took out (its slot's own
    colours win, skin.lua restoredAt), a dead one, one that already has these
    colours (a relog the game saved). Written by skin.lua (field by field).

    Game thread (H.every in main.lua): reads one small file only when a new
    dino needs it.
]]

local H    = require("shared.isle.helpers")
local json = require("shared.isle.json")
local Msg  = require("shared.isle.messages")
local Skin = require("garage.skin")

local K = {}

K.PATH = "Mods/DinoGarage/Saved/skins.json"
K.DELAY_S = 5
K.GARAGE_WINDOW_S = 60

local seen = {}   -- steamId -> { addr, since, done }

local function readSaved()
    local f = io.open(K.PATH, "r")
    if not f then return nil end
    local raw = f:read("*a")
    f:close()
    local ok, d = pcall(json.decode, raw or "")
    return ok and type(d) == "table" and type(d.players) == "table" and d.players or nil
end

--- "BlueprintGeneratedClass /Game/…/BP_Deinosuchus.BP_Deinosuchus_C" -> "BP_Deinosuchus_C"
local function classOf(pawn)
    local ok, n = pcall(function() return pawn:GetClass():GetFName():ToString() end)
    if not ok or n == nil then return nil end
    return tostring(n):match("([%w_]+)$")
end

--- Does the dino already wear these colours (within rounding)?
local function wears(pawn, sk)
    local now = H.readSkin(pawn)
    if now == nil then return false end
    for region, c in pairs(sk.colors) do
        local n = now.colors[region]
        if n == nil or math.abs(n.r - c.r) > 0.01 or math.abs(n.g - c.g) > 0.01 or math.abs(n.b - c.b) > 0.01 then return false end
    end
    if sk.pattern ~= nil and now.patternIndex ~= sk.pattern then return false end
    if sk.theme ~= nil and now.themeIndex ~= sk.theme then return false end
    return true
end

--- One pass over the players online.
function K.poll()
    local now = os.time()
    local players = nil     -- the file, read once per pass and only if needed
    local online = {}
    H.forEachPlayer(function(ctrl)
        local id = H.safeSteamId(ctrl)
        if not id then return end
        online[id] = true
        local pawn = H.livePawnFromCtrl(ctrl)
        if not pawn then return end
        local okA, addr = pcall(function() return pawn:GetAddress() end)
        if not okA or addr == nil or addr == 0 then return end
        local st = seen[id]
        if st == nil or st.addr ~= addr then
            seen[id] = { addr = addr, since = now }
            return
        end
        if st.done or now - st.since < K.DELAY_S then return end
        st.done = true
        local restored = Skin.restoredAt[id]
        if restored ~= nil and now - restored < K.GARAGE_WINDOW_S then return end
        local okH, hp = pcall(function() return pawn:GetHealth() end)
        if not okH or type(hp) ~= "number" or hp <= 0 then return end
        players = players or readSaved() or {}
        local cls = classOf(pawn)
        local saved = cls and type(players[id]) == "table" and players[id][cls] or nil
        if type(saved) ~= "table" then return end
        local sk = Skin.validate(saved)
        if sk == nil or wears(pawn, sk) then return end
        local wrote = Skin.apply(pawn, sk)
        if wrote and wrote > 0 then
            H.log(string.format("keepskin: %s's kept %s colours painted (%d fields)", id, cls, wrote))
            Msg.notify(ctrl, "skin.kept", "Đã tô lại màu bạn giữ cho loài này.")
        end
    end)
    for id in pairs(seen) do if not online[id] then seen[id] = nil end end
end

return K
