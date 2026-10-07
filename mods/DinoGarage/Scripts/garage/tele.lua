--[[
    DinoGarage/tele.lua

    Tele con non (owner, 2026-10-06): A takes a code on the web (Dino Live),
    B types it; the bridge (bridge/src/tele.ts) checks the code and sends the
    "tele" inbox command { steamId = B, target = A, maxGrowth, targetMaxGrowth,
    combatS, countdownS, cooldownS }. Here, on the game thread:

      * both online with a living dino, neither in prison
      * both at most their growth (GetGrowth, 0-1): 40 % by default
      * B not in a fight for the last combatS seconds: no player hit dealt or
        taken (the ApplyDamage hook, noteHit) and no health lost (AI bites,
        falls, bleeding fire no hook: track() samples every player's health)
      * B stands still countdownS seconds (5 m, no damage, the same dino),
        like a garage store; then B is put where A stands (A on the ground:
        not falling, flying or swimming), and the cooldown starts

    The outcome: a `tele_result` event { id, steamId, target, ok, reason }
    (the bridge settles the code by it). Nothing here sets growth or vitals:
    only K2_SetActorLocation on B (Restore.teleport, as a garage redeem at the
    stored spot does).
]]

local H       = require("shared.isle.helpers")
local Events  = require("shared.isle.events")
local Msg     = require("shared.isle.messages")
local Prison  = require("shared.isle.prison")
local Restore = require("garage.restore")

local T = {}

T.GUARD_MS         = 1500    -- track() + the countdown guard (a loop of its own)
T.RADIUS_CM        = 500     -- 5 m, as a garage store
T.HEALTH_SLACK_PCT = 0.01    -- health lost beyond 1 % of max = "took damage"
local FORGET_S     = 900     -- hits older than this are forgotten

local hitAt   = {}   -- pawn address -> os.time() of its last player hit, dealt or taken
local sample  = {}   -- steamId -> { addr, hp } the last health read
local hurtAt  = {}   -- steamId -> { addr, t } when that dino last lost health
local movedAt = {}   -- steamId -> os.time() of their last tele (the cooldown)
local pending = {}   -- steamId -> the tele counting down

-- Why a countdown ended without a move (the web shows it; not editable, put in tele.failed's {reason}).
local WHY = {
    moved         = "bạn đã rời khỏi bán kính 5 m",
    damage_dealt  = "bạn đã gây sát thương",
    damage_taken  = "bạn đã chịu sát thương",
    left          = "bạn đã thoát game hoặc dino đã chết",
    not_same_dino = "không còn là con dino lúc bắt đầu",
    target_gone   = "người đưa mã đã thoát game hoặc dino đã chết",
    target_air    = "người đưa mã đang bay, bơi hoặc rơi",
    target_growth = "dino của người đưa mã đã lớn quá mức cho phép",
    other_species = "dino của người đưa mã khác loài với bạn",
    growth        = "dino của bạn đã lớn quá mức cho phép",
    prison        = "một trong hai đang ở tù",
    failed        = "không dịch chuyển được",
}
T.WHY = WHY

--- The pawn's class (BP_Tyrannosaurus_C), or nil: tele goes to a dino of the same species only (owner, 2026-10-07).
local function classOf(pawn)
    local ok, n = pcall(function() return pawn:GetClass():GetFName():ToString() end)
    return ok and n ~= nil and tostring(n) or nil
end
--- Same species, or one of the two classes unreadable (refused: the move is the risk).
local function sameSpecies(a, b)
    local ca, cb = classOf(a), classOf(b)
    return ca ~= nil and cb ~= nil and ca == cb
end
T.sameSpecies = sameSpecies

local function addressOf(pawn)
    local ok, a = pcall(function() return pawn:GetAddress() end)
    return ok and a or nil
end

local function num(pawn, fn)
    local ok, v = pcall(function() return pawn[fn](pawn) end)
    return ok and type(v) == "number" and v or nil
end

local function locOf(pawn)
    local ok, l = pcall(function() local v = pawn:K2_GetActorLocation(); return { x = v.X, y = v.Y, z = v.Z } end)
    if ok and l and type(l.x) == "number" and type(l.y) == "number" and type(l.z) == "number" then return l end
    return nil
end

local function yawOf(pawn)
    local ok, r = pcall(function() return pawn:K2_GetActorRotation() end)
    return ok and r and type(r.Yaw) == "number" and r.Yaw or nil
end

local function alive(pawn)
    local hp = pawn and num(pawn, "GetHealth")
    return hp ~= nil and hp > 0
end

local function findCtrl(steamId)
    local found = nil
    H.forEachPlayer(function(c)
        if found == nil and H.safeSteamId(c) == steamId then found = c end
    end)
    return found
end

--- On the ground: not falling, flying or swimming (PlayerCommands' !unstuck test).
local function grounded(pawn)
    local ok, g = pcall(function()
        local move = pawn.CharacterMovement
        if not H.isValid(move) then return false end
        return move:IsMovingOnGround() == true and move:IsSwimming() ~= true and move:IsFalling() ~= true
    end)
    return ok and g == true
end

--- At most `max` (0-1). A growth that cannot be read is refused: the move is the risk.
local function growthOk(pawn, max)
    local g = num(pawn, "GetGrowth")
    return g ~= nil and g <= max + 1e-6, g
end

local function pct(v) return math.floor((v or 0) * 100 + 1e-6) end

--- Seconds B must still wait after a fight, or nil (this dino: its address).
function T.combatLeft(steamId, pawn, window)
    if not window or window <= 0 then return nil end
    local addr = addressOf(pawn)
    local last = addr and hitAt[addr] or nil
    local hurt = hurtAt[steamId]
    if hurt and hurt.addr == addr and (last == nil or hurt.t > last) then last = hurt.t end
    if last == nil then return nil end
    local left = window - (os.time() - last)
    if left > 0 then return left end
    return nil
end

local function result(steamId, p, ok, reason)
    Events.emit({ type = "tele_result", id = p.cmdId, steamId = steamId, target = p.target, ok = ok, reason = reason })
end

local function fail(steamId, reason, c)
    local p = pending[steamId]
    if p == nil then return end
    pending[steamId] = nil
    result(steamId, p, false, reason)
    c = c or findCtrl(steamId)
    if c then Msg.notify(c, "tele.failed", "Tele thất bại: {reason}. Mã vẫn dùng được nếu chưa hết hạn.", { reason = WHY[reason] or reason }) end
    H.log("tele: " .. steamId .. " -> " .. tostring(p.target) .. " failed: " .. reason)
end

--- The damage hook (player on player; reads only): who fought, and a counting-down tele that fights fails.
function T.noteHit(attackerAddr, targetAddr)
    local now = os.time()
    if attackerAddr ~= nil then hitAt[attackerAddr] = now end
    if targetAddr ~= nil then hitAt[targetAddr] = now end
    for steamId, p in pairs(pending) do
        if attackerAddr ~= nil and attackerAddr == p.address then fail(steamId, "damage_dealt")
        elseif targetAddr ~= nil and targetAddr == p.address then fail(steamId, "damage_taken") end
    end
end

--- The move, when the countdown ends (game thread).
local function finish(c, pawn, steamId, p)
    if addressOf(pawn) ~= p.address then return fail(steamId, "not_same_dino", c) end
    if Prison.isInmate(steamId) or Prison.isInmate(p.target) then return fail(steamId, "prison", c) end
    if not growthOk(pawn, p.maxGrowth) then return fail(steamId, "growth", c) end
    local tc = findCtrl(p.target)
    local tp = tc and H.livePawnFromCtrl(tc)
    if not tp or not alive(tp) then return fail(steamId, "target_gone", c) end
    if not growthOk(tp, p.targetMaxGrowth) then return fail(steamId, "target_growth", c) end
    if not sameSpecies(pawn, tp) then return fail(steamId, "other_species", c) end
    if not grounded(tp) then return fail(steamId, "target_air", c) end
    local at = locOf(tp)
    if at == nil then return fail(steamId, "failed", c) end
    pending[steamId] = nil
    if not Restore.teleport(pawn, at, { yaw = yawOf(tp) }) then
        result(steamId, p, false, "failed")
        Msg.notify(c, "tele.failed", "Tele thất bại: {reason}. Mã vẫn dùng được nếu chưa hết hạn.", { reason = WHY.failed })
        return
    end
    movedAt[steamId] = os.time()
    result(steamId, p, true, nil)
    Msg.notify(c, "tele.done", "Đã dịch chuyển tới chỗ người đưa mã.")
    Msg.notify(tc, "tele.arrived", "Một người vừa dịch chuyển tới chỗ bạn bằng mã tele.")
    H.log(string.format("tele: %s moved to %s at %d, %d, %d", steamId, p.target, math.floor(at.x), math.floor(at.y), math.floor(at.z)))
end

--- The "tele" inbox command: every check, then the countdown. Returns true once it started.
function T.start(ctrl, cmd, say)
    local steamId = cmd.steamId
    local target = cmd.target
    local maxGrowth, targetMax = tonumber(cmd.maxGrowth), tonumber(cmd.targetMaxGrowth)
    local combatS, countdownS, cooldownS = tonumber(cmd.combatS), tonumber(cmd.countdownS), tonumber(cmd.cooldownS)
    if type(target) ~= "string" or not target:match("^%d+$") or target == steamId or not maxGrowth or not targetMax
        or not combatS or not countdownS or not cooldownS then
        say("tele: bad arguments")
        return false
    end
    if Prison.isInmate(steamId) then Msg.say(say, "tele.prison", "Bạn đang ở tù: không tele được."); return false end
    if Prison.isInmate(target) then Msg.say(say, "tele.targetPrison", "Người đưa mã đang ở tù: không tele tới được."); return false end
    if pending[steamId] then Msg.say(say, "tele.busy", "Đang có một lần tele đếm ngược."); return false end
    local last = movedAt[steamId]
    if last and last + cooldownS > os.time() then
        Msg.say(say, "tele.cooldown", "Tele đang hồi: chờ {seconds} giây.", { seconds = last + cooldownS - os.time() })
        return false
    end
    local pawn = H.livePawnFromCtrl(ctrl)
    if not pawn or not alive(pawn) then Msg.say(say, "tele.noDino", "Bạn cần đang điều khiển một con dino còn sống để tele."); return false end
    local okG, g = growthOk(pawn, maxGrowth)
    if not okG then
        Msg.say(say, "tele.tooBig", "Chỉ dino từ {max}% tăng trưởng trở xuống mới tele được (dino của bạn {growth}%).",
            { max = pct(maxGrowth), growth = pct(g) })
        return false
    end
    local tc = findCtrl(target)
    local tp = tc and H.livePawnFromCtrl(tc)
    if not tp or not alive(tp) then Msg.say(say, "tele.targetGone", "Người đưa mã không còn trong game hoặc dino đã chết."); return false end
    if not growthOk(tp, targetMax) then
        Msg.say(say, "tele.targetBig", "Dino của người đưa mã đã lớn hơn {max}%: không tele tới được.", { max = pct(targetMax) })
        return false
    end
    if not sameSpecies(pawn, tp) then Msg.say(say, "tele.otherSpecies", "Chỉ tele tới dino cùng loài."); return false end
    local wait = T.combatLeft(steamId, pawn, combatS)
    if wait then Msg.say(say, "tele.combat", "Bạn vừa giao tranh: chờ {seconds} giây nữa mới tele được.", { seconds = wait }); return false end
    local origin = locOf(pawn)
    if origin == nil then say("tele: no location"); return false end

    local hp = num(pawn, "GetHealth")
    local p = { cmdId = cmd.id, target = target, address = addressOf(pawn), origin = origin, health = hp,
                maxHealth = num(pawn, "GetMaxHealth") or hp, maxGrowth = maxGrowth, targetMaxGrowth = targetMax }
    pending[steamId] = p
    if countdownS > 0 then
        Msg.say(say, "tele.countdown", "Dịch chuyển sau {seconds} giây: đứng yên trong bán kính 5 m, không đánh và không bị đánh.", { seconds = countdownS })
    end
    H.deferWithPawn(ctrl, countdownS * 1000, function(c, livePawn)
        if pending[steamId] ~= p then return end
        finish(c, livePawn, steamId, p)
    end, function()
        if pending[steamId] == p then
            pending[steamId] = nil
            result(steamId, p, false, "left")
        end
    end)
    return true
end

--- Every GUARD_MS (game thread): each player's health sampled (a drop = in a fight), then
--- every counting-down tele still in place and unhurt.
function T.guard()
    local now = os.time()
    local slackOf = function(max) return math.max(1, (max or 0) * T.HEALTH_SLACK_PCT) end
    H.forEachPlayer(function(c)
        local id = H.safeSteamId(c)
        local pawn = id and H.livePawnFromCtrl(c)
        if not pawn then return end
        local hp = num(pawn, "GetHealth")
        if hp == nil then return end
        local addr = addressOf(pawn)
        local prev = sample[id]
        if prev and prev.addr == addr and hp < prev.hp - slackOf(num(pawn, "GetMaxHealth") or prev.hp) then
            hurtAt[id] = { addr = addr, t = now }
        end
        sample[id] = { addr = addr, hp = hp }
    end)
    for addr, t in pairs(hitAt) do if now - t > FORGET_S then hitAt[addr] = nil end end

    for steamId, p in pairs(pending) do
        local c = findCtrl(steamId)
        local pawn = c and H.livePawnFromCtrl(c)
        if Prison.isInmate(steamId) then
            fail(steamId, "prison", c)
        elseif pawn then   -- gone: the countdown's own onGone handles it
            local here = locOf(pawn)
            local o = p.origin
            local hp = num(pawn, "GetHealth")
            if addressOf(pawn) ~= p.address then
                fail(steamId, "not_same_dino", c)
            elseif here and math.sqrt((here.x - o.x) ^ 2 + (here.y - o.y) ^ 2 + (here.z - o.z) ^ 2) > T.RADIUS_CM then
                fail(steamId, "moved", c)
            elseif hp and p.health and hp < p.health - slackOf(p.maxHealth or p.health) then
                fail(steamId, "damage_taken", c)
            end
        end
    end
end

--- Is anything counting down (the damage hook's early way out)?
function T.busy() return next(pending) ~= nil end

--- For tests: forget everything.
function T.reset() hitAt, sample, hurtAt, movedAt, pending = {}, {}, {}, {}, {} end

return T
