--[[
    PlayerCommands — chat commands for players.

        !slay      kill your current dino (cooldown)
        !unstuck   move back to the last spot you stood on the GROUND, a few
                   metres from here (cooldown). Never from a height: the spots
                   are recorded only while the dino is walking on the ground.
        !prime     is this dino a prime elder / eligible for prime
        !status    growth and vitals of your current dino
        !food      let go of whatever is stuck in the mouth (cooldown): a
                   critter grabbed (ReleasePhysicsCharacter, as PteraCarry
                   uses), the piece carried / dragged (SetDraggedPickablePiece
                   / SetDraggedActor with none), and the "food nearby" state
                   (ServerResetPickableNearby) — the game's own setters

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
local Msg  = require("shared.isle.messages")   -- texts editable on the admin panel
local Prison = require("shared.isle.prison")   -- who is serving time (mods/Prison)

local MOD = "PlayerCommands"
local SETTINGS_PATH = "Mods/PlayerCommands/Saved/settings.json"

local DEFAULTS = {
    slayCooldown    = 300,     -- seconds between two !slay by one player
    unstuckCooldown = 600,     -- seconds between two !unstuck
    foodCooldown    = 30,      -- seconds between two !food
    enabled = { slay = true, unstuck = true, prime = true, status = true, food = true },
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
    local s = { slayCooldown = DEFAULTS.slayCooldown, unstuckCooldown = DEFAULTS.unstuckCooldown, foodCooldown = DEFAULTS.foodCooldown, enabled = {} }
    for k, v in pairs(DEFAULTS.enabled) do s.enabled[k] = v end
    local f = io.open(SETTINGS_PATH, "r")
    if not f then return s end
    local raw = f:read("*a")
    f:close()
    local ok, data = pcall(json.decode, raw)
    if not ok or type(data) ~= "table" then return s end
    for _, key in ipairs({ "slayCooldown", "unstuckCooldown", "foodCooldown" }) do
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

local lastUse = { slay = {}, unstuck = {}, food = {} }

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
        Msg.notify(ctrl, "cmd.slay.cooldown", "!slay: chờ thêm {wait}.", { wait = fmtWait(left) })
        return
    end
    local pawn = H.livePawnFromCtrl(ctrl)
    if not pawn then
        Msg.notify(ctrl, "cmd.slay.noDino", "!slay: bạn chưa điều khiển dino nào.")
        return
    end
    if H.try(MOD .. ": slay SetHealth(0)", function() pawn:SetHealth(0) end) then
        lastUse.slay[steamId] = os.time()
        Msg.notify(ctrl, "cmd.slay.done", "Dino của bạn đã chết. Chọn loài để spawn lại.")
    else
        Msg.notify(ctrl, "cmd.slay.failed", "!slay không thực hiện được, thử lại sau.")
    end
end

local function doUnstuck(ctrl, steamId, settings)
    local left = cooldownLeft("unstuck", steamId, settings.unstuckCooldown)
    if left then
        Msg.notify(ctrl, "cmd.unstuck.cooldown", "!unstuck: chờ thêm {wait}.", { wait = fmtWait(left) })
        return
    end
    local pawn = H.livePawnFromCtrl(ctrl)
    if not pawn then
        Msg.notify(ctrl, "cmd.unstuck.noDino", "!unstuck: bạn chưa điều khiển dino nào.")
        return
    end
    local here = locationOf(pawn)
    local target = here and unstuckTarget(steamId, here)
    if not target then
        Msg.notify(ctrl, "cmd.unstuck.noSafeSpot", "!unstuck: chưa có điểm an toàn trên mặt đất — đi bộ trên mặt đất vài giây rồi thử lại.")
        return
    end
    local ok, moved = H.try(MOD .. ": unstuck K2_SetActorLocation", function()
        return pawn:K2_SetActorLocation({ X = target.x, Y = target.y, Z = target.z + UNSTUCK_LIFT }, false, {}, true)
    end)
    if ok and moved ~= false then
        lastUse.unstuck[steamId] = os.time()
        Msg.notify(ctrl, "cmd.unstuck.done", "Đã đưa bạn về điểm an toàn cách {meters} m.", { meters = string.format("%.0f", dist(here, target) / 100) })
    else
        Msg.notify(ctrl, "cmd.unstuck.failed", "!unstuck không thực hiện được, thử lại sau.")
    end
end

local function doFood(ctrl, steamId, settings)
    local left = cooldownLeft("food", steamId, settings.foodCooldown)
    if left then
        Msg.notify(ctrl, "cmd.food.cooldown", "!food: chờ thêm {wait}.", { wait = fmtWait(left) })
        return
    end
    local pawn = H.livePawnFromCtrl(ctrl)
    if not pawn then
        Msg.notify(ctrl, "cmd.food.noDino", "!food: bạn chưa điều khiển dino nào.")
        return
    end
    -- What is in the mouth now (read only), for the log and the answer.
    local okP, piece = pcall(function() return pawn:GetDraggedPickablePiece() end)
    local hadPiece = okP and piece ~= nil and H.isValid(piece)
    local done = {}
    if pcall(function() pawn:ReleasePhysicsCharacter() end) then done[#done + 1] = "release" end
    if hadPiece and pcall(function() pawn:SetDraggedPickablePiece(nil) end) then done[#done + 1] = "piece" end
    if pcall(function() pawn:SetDraggedActor(nil) end) then done[#done + 1] = "dragged" end
    if pcall(function() pawn:ServerResetPickableNearby() end) then done[#done + 1] = "nearby" end
    H.log(string.format("%s: !food by %s — had a piece: %s, done: %s", MOD, steamId, tostring(hadPiece), table.concat(done, ",")))
    if #done == 0 then
        Msg.notify(ctrl, "cmd.food.failed", "!food không thực hiện được, thử lại sau.")
        return
    end
    lastUse.food[steamId] = os.time()
    Msg.notify(ctrl, "cmd.food.done", "Đã nhả thứ trong mồm. Nếu vẫn kẹt, thoát ra vào lại hoặc dùng !unstuck.")
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
        Msg.notify(ctrl, "cmd.prime.noDino", "!prime: bạn chưa điều khiển dino nào.")
        return
    end
    local isPrime = callBool(pawn, "IsPrimeElder")
    local eligible = callBool(pawn, "GetIsEligiblePrimeElder")
    -- The ten conditions the game keeps (EligiblePrimeElderData); 5 make a
    -- dino eligible (every reading on this server, bridge/src/prime.ts).
    local done = nil
    local okD, data = pcall(function() return pawn.EligiblePrimeElderData end)
    if okD and data ~= nil then
        done = 0
        for i = 1, 10 do
            local okC, v = pcall(function() return data["bPrimeCondition" .. i] end)
            if okC and v == true then done = done + 1 end
        end
    end
    local growth = H.readVital(pawn, "GetGrowth", { "Growth" }, "growth")
    local status
    if isPrime == true then status = "đã là Prime 👑"
    elseif growth and growth >= 0.75 then status = "không (đã qua mốc 75%)"
    else status = "chưa — game xét ở 75% growth" end
    Msg.notify(ctrl, "cmd.prime.info",
        "Nhiệm vụ prime: {done}/10 xong (cần {needed}) · Đủ điều kiện: {eligible} · Prime: {status} · Growth {growth}.",
        { done = done ~= nil and tostring(done) or "?", needed = "5", eligible = yesNo(eligible), prime = yesNo(isPrime),
          status = status, growth = growth and string.format("%.0f%%", growth * 100) or "?" })
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
        Msg.notify(ctrl, "cmd.status.noDino", "!status: bạn chưa điều khiển dino nào.")
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

local COMMANDS = { slay = doSlay, unstuck = doUnstuck, prime = doPrime, status = doStatus, food = doFood }
-- An inmate (mods/Prison) may not kill, move or free their dino (!food) out of the prison.
-- !prime / !status only read, and still answer.
local NOT_IN_PRISON = { slay = true, unstuck = true, food = true }

H.onChat(function(ctrl, steamId, msg)
    local cmd = H.parseCommand(msg)
    local handler = cmd and COMMANDS[cmd]
    if not handler then return end
    local settings = readSettings()
    if settings.enabled[cmd] == false then
        Msg.notify(ctrl, "cmd.disabled", "!{command} đang bị tắt trên server này.", { command = cmd })
        return
    end
    if NOT_IN_PRISON[cmd] and Prison.isInmate(steamId) then
        Msg.notify(ctrl, "cmd.prison", "!{command} không dùng được khi đang ở tù.", { command = cmd })
        return
    end
    handler(ctrl, steamId, settings)
end)

-- Ground tracker: a game-thread loop (H.every), never a closure queued from
-- the async thread each tick (lost callbacks, 2026-09-24).
H.every(TRACK_MS, MOD .. ": ground spots", recordSpots)

-- Chat commands kept out of the chat others see (owner, 2026-10-04: "!unstuck"
-- showed in everyone's chat box). GetChatMessage fires once per RECEIVING
-- controller before the game sends the line down to that player: its two
-- texts (NewText, NoFilterMsg) blanked there, the line carries nothing.
-- Registered HIDE_AFTER_MS after load, so that it runs after every other mod's
-- chat hook (StatsLogger's chat log, DinoGarage, PteraCarry's commands…):
-- hooks run in the order they were registered, and those read the words first.
-- New on the live server and not documented upstream: a flag first (as the
-- garage's first prime writes): written before the first blanking of a run,
-- removed HIDE_SETTLE_MS later. Found at load (the server went down right
-- after one) and the hiding stays off; the commands themselves still work.
local CHAT_HOOK_NAME = "/Script/TheIsle.TIPlayerController:GetChatMessage"
local HIDE_AFTER_MS = 15000
local HIDE_SETTLE_MS = 20000
local HIDE_FLAG = "Mods/PlayerCommands/Saved/hide-chat.trying"
local hideOn = true
do
    local f = io.open(HIDE_FLAG, "r")
    if f then
        f:close()
        hideOn = false
        H.logError(MOD .. ": the last run stopped right after hiding a chat command — hiding is off. Delete "
            .. HIDE_FLAG .. " to try again.")
    end
end
local hideArmed = false

--- A player's chat command ("!unstuck", " !prime"): kept out of the chat.
local function isChatCommand(text)
    return type(text) == "string" and text:match("^%s*!%a") ~= nil
end

--- A value Lua can call: a function, or a table / userdata with __call.
local function callable(v)
    if type(v) == "function" then return true end
    if type(v) ~= "table" and type(v) ~= "userdata" then return false end
    local mt = getmetatable(v)
    return type(mt) == "table" and mt.__call ~= nil
end

--- An empty FText, and how it was made: UE4SS's FText("") (a plain function in
-- some builds, a callable object in others — the live server's 2026-10-04 run
-- found no plain function and the hiding stayed off without a word), else the
-- engine's own KismetTextLibrary:Conv_StringToText(""). nil when neither works.
local function emptyText()
    if callable(FText) then
        local ok, t = pcall(FText, "")
        if ok and t ~= nil then return t, "FText" end
    end
    local okLib, lib = pcall(StaticFindObject, "/Script/Engine.Default__KismetTextLibrary")
    if okLib and lib ~= nil and lib:IsValid() then
        local ok, t = pcall(function() return lib:Conv_StringToText("") end)
        if ok and t ~= nil then return t, "KismetTextLibrary" end
    end
    return nil
end

local function blank(param)
    if param == nil then return end
    local t = emptyText()
    if t ~= nil then pcall(function() param:set(t) end) end
end

if hideOn then
    H.defer(HIDE_AFTER_MS, function()
        H.try(MOD .. ": hide chat commands hook", function()
            local probe, via = emptyText()
            if probe == nil then
                H.logError(MOD .. ": cannot make an empty chat text (FText is a " .. type(FText)
                    .. ", no KismetTextLibrary) — chat commands stay visible")
                return
            end
            RegisterHook(CHAT_HOOK_NAME, function(_self, textParam, _sender, _mode, rawParam)
                local ok, text = pcall(function() return H.textOf(textParam:get()) end)
                if not (ok and isChatCommand(text)) then return end
                if not hideArmed then
                    hideArmed = true
                    local f = io.open(HIDE_FLAG, "w")
                    if f then f:write(tostring(os.time())); f:close() end
                    H.defer(HIDE_SETTLE_MS, function()
                        os.remove(HIDE_FLAG)
                        H.log(MOD .. ": hiding chat commands works (first one went through)")
                    end)
                end
                blank(textParam)
                blank(rawParam)
            end)
            H.log(MOD .. ": chat commands hidden from the chat (hook after the other mods', empty text via " .. via .. ")")
        end)
    end)
end

H.log(MOD .. ": loaded")
