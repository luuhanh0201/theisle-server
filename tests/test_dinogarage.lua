-- Functional test: drives DinoGarage through full store / redeem cycles the
-- way the web garage does (a command in Saved/inbox.json, run by the inbox
-- poll), against the mock UE4SS harness. The chat commands are gone: typing
-- them only points the player to the web.

-- The harness replaces the global print (mods log through it), so keep a real
-- writer for the test's own output.
local function say(s) io.write(tostring(s)) io.write(string.char(10)) end

local H = require("harness")

local pass, fail = 0, 0
local function check(name, ok, detail)
  if ok then pass = pass + 1; say("  ok   " .. name)
  else fail = fail + 1; say("  FAIL " .. name .. (detail and ("  -> " .. detail) or "")) end
end

local STEAM  = "76561198000000001"
local CHAT   = "/Script/TheIsle.TIPlayerController:GetChatMessage"
local DAMAGE = "/Script/TheIsle.TICharacterBase:ApplyDamage"
local EVENTS = "Mods/StatsLogger/Saved/events.ndjson"
os.remove(EVENTS)

-- A clock the test drives: the garage cooldown and command expiry use os.time().
local clock = 2000000
os.time = function() return clock end

-- Panel settings: most sections run without the garage cooldown.
local SETTINGS = "Mods/DinoGarage/Saved/garage-settings.json"
local function writeSettings(text)
  local f = assert(io.open(SETTINGS, "w")); f:write(text); f:close()
end
writeSettings('{"storeCountdown":30,"cooldown":0}')

-- Load the mod exactly as UE4SS would.
-- gasVitals: like the live server, vitals are only reachable through getters.
local pawn = H.makePawn({ growth = 0.9, mutation = "MUT_Life", gasVitals = true })
local ctrl = H.makeCtrl(STEAM, pawn)
_G.FindAllOf = function() H.touch("FindAllOf"); return { ctrl } end

dofile(RUN .. "/Mods/DinoGarage/Scripts/main.lua")
local json = require("shared.isle.json")
local Storage = require("garage.storage")

local poll, guard
for _, l in ipairs(H.gameLoops) do
  if l.ms == 2000 then poll = l elseif l.ms == 1000 then guard = l end
end

-- One web command: written to the inbox, run by one poll (game thread).
local nextId = 0
local function send(kind, fields)
  nextId = nextId + 1
  local c = { id = nextId, type = kind, steamId = (fields and fields.steamId) or STEAM,
              createdAt = clock, expiresAt = clock + 600,
              slot = fields and fields.slot, where = fields and fields.where }
  local f = assert(io.open("Mods/DinoGarage/Saved/inbox.json", "w"))
  f:write(json.encode({ commands = { c } }))
  f:close()
  poll.fn()
  return nextId
end
local function eventsOf(kind)
  local out = {}
  local f = io.open(EVENTS, "r")
  if not f then return out end
  for line in f:lines() do
    local ok, e = pcall(json.decode, line)
    if ok and e.type == kind then out[#out + 1] = e end
  end
  f:close()
  return out
end
local function byId(kind, id) for _, e in ipairs(eventsOf(kind)) do if e.id == id then return e end end end
local function started(id) return byId("portal_command", id) end
local function final(id) return byId("garage_store_result", id) end
local function useCtrl(c) _G.FindAllOf = function() H.touch("FindAllOf"); return { c } end end
local function lastMsg(c) local m = c._messages; return m[#m] or "" end

print("\n-- 1. loads: inbox + store guard run on the game thread; chat only points to the web --")
check("inbox poll registered (2 s, game thread)", poll ~= nil)
check("store guard registered (1 s, game thread)", guard ~= nil)
H.chat(CHAT, ctrl, ctrl, "!store")
H.advance(40000)
check("typing !store stores nothing", H.countCalls("SetHealth") == 0 and next(Storage.listSlots(STEAM)) == nil)
check("...and says the garage is on the web", lastMsg(ctrl):find("trang web", 1, true) ~= nil, lastMsg(ctrl))

print("\n-- 2. store counts down, then captures, saves and removes in ONE tick, into slot 1 --")
local id2 = send("store")
check("accepted: the countdown started", started(id2) and started(id2).ok == true)
check("the stand-still rules are told", (started(id2).messages[1] or ""):find("5 m", 1, true) ~= nil,
      started(id2).messages[1])
H.advance(10)
local slotFile = RUN .. "/Mods/DinoGarage/Saved/stored/" .. STEAM .. "__1.json"
check("nothing saved during the countdown", io.open(slotFile, "r") == nil)
check("dino untouched during the countdown", H.countCalls("SetHealth") == 0)
guard.fn(); guard.fn()
check("standing still: the guard lets it run", final(id2) == nil)
H.advance(20000)
local warned = false
for _, m in ipairs(ctrl._messages) do if m:match("10 giây") then warned = true end end
check("a 10-seconds-left warning", warned)
H.advance(10100)
check("stored and removed together at 30 s", H.countCalls("SetHealth") == 1 and io.open(slotFile, "r") ~= nil,
      "SetHealth x" .. H.countCalls("SetHealth"))
check("final result for the web: ok, slot 1", final(id2) and final(id2).ok == true and final(id2).slot == "1",
      final(id2) and json.encode(final(id2)))
local f = io.open(slotFile, "r")
local raw = f and f:read("*a") or ""
if f then f:close() end
local okDecode, state = pcall(json.decode, raw)
check("slot file is valid JSON", okDecode, tostring(state))
if okDecode then
  check("version = 1", state.version == 1, tostring(state.version))
  check("growth captured (the real one, before the corpse shrink)", state.growth == 0.9, tostring(state.growth))
  local shrunkAt, killedAt
  for i, c in ipairs(H.calls) do
    if c.what == "SetGrowth" and shrunkAt == nil then shrunkAt = i; check("corpse shrunk to 25 %", c.args[1] == 0.25, tostring(c.args[1])) end
    if c.what == "SetHealth" and c.args[1] == 0 then killedAt = i end
  end
  check("shrunk, then killed: the corpse is a hatchling's", shrunkAt ~= nil and killedAt ~= nil and shrunkAt < killedAt,
        tostring(shrunkAt) .. " / " .. tostring(killedAt))
  check("health captured through GetHealth()", state.health == 100, tostring(state.health))
  check("stamina/hunger/thirst captured", state.stamina == 80 and state.hunger == 70
        and state.thirst == 65, tostring(state.stamina))
  check("max values captured", state.maxHunger == 100 and state.maxThirst == 100
        and state.maxStamina == 100, tostring(state.maxHunger))
  check("max health captured (for the web garage's bar)", state.maxHealth == 100, tostring(state.maxHealth))
  check("not prime: no prime flag stored", state.prime == nil, tostring(state.prime))
  check("classPath captured", state.classPath ~= nil, tostring(state.classPath))
  check("active mutation captured", state.mutations.Slot1 == "MUT_Life", tostring(state.mutations.Slot1))
  check("inherited mutation captured", state.mutations.ParentSlot1 == "MUT_Parent",
        tostring(state.mutations.ParentSlot1))
  check("'None' slot stored as nil", state.mutations.Slot2 == nil, tostring(state.mutations.Slot2))
  check("elder stacks captured", state.elderStacks == 3, tostring(state.elderStacks))
  check("skin captured with the slot", state.skin and state.skin.colors.Body and state.skin.patternIndex == 3,
        state.skin and "ok" or "no skin")
  check("nutrients captured", state.nutrients.carbValue == 5, tostring(state.nutrients.carbValue))
end

print("\n-- 3. the kill used 0 health --")
check("killed with 0", H.calls[#H.calls].args[1] == 0, tostring(H.calls[#H.calls].args[1]))

print("\n-- 4. redeem on the WRONG species is refused --")
H.calls = {}
local wrongCtrl = H.makeCtrl(STEAM, H.makePawn({ class = "BlueprintGeneratedClass /Game/BP_Carno.BP_Carno_C" }))
useCtrl(wrongCtrl)
local id4 = send("redeem", { slot = "1" })
H.advance(4000)
check("no restore attempted", H.countCalls("SetGrowth") == 0, "SetGrowth x" .. H.countCalls("SetGrowth"))
check("refused, with the reason", started(id4) and started(id4).ok == false
      and (started(id4).messages[1] or ""):match("Wrong species") ~= nil)

print("\n-- 5. redeem on the right species restores, in cookbook order --")
H.calls = {}
local freshCtrl = H.makeCtrl(STEAM, H.makePawn({ growth = 0.05, mutation = "None" }))
useCtrl(freshCtrl)
send("redeem", { slot = "1" })
H.advance(10)
check("restore deferred, nothing applied yet", H.countCalls("SetGrowth") == 0)
H.advance(3100)    -- the 3s restore delay
check("growth applied in first pass", H.countCalls("SetGrowth") == 1)
check("vitals applied in first pass", H.countCalls("SetHealth") >= 1)
check("inherited slots pushed", H.countCalls("SetReplicatedMutationsData") == 1)
check("nutrients pushed", H.countCalls("SetNutrientsStruct") == 1)
check("elder stacks NOT applied yet", H.countCalls("SetElderReplicationStacks") == 0)
H.advance(600)     -- the 500ms settle window
check("active slots pushed after settle", H.countCalls("SetReplicatedMutationsData") == 2,
      tostring(H.countCalls("SetReplicatedMutationsData")))
check("vitals re-applied after growth wipe", H.countCalls("SetHealth") >= 2, "SetHealth x" .. H.countCalls("SetHealth"))
check("elder stacks applied last", H.countCalls("SetElderReplicationStacks") == 1)
local names = H.callNames()
local function firstIndex(n) for i, v in ipairs(names) do if v == n then return i end end end
local function lastIndex(n) local r; for i, v in ipairs(names) do if v == n then r = i end end return r end
check("SetGrowth precedes the final SetHealth", firstIndex("SetGrowth") < lastIndex("SetHealth"))
check("final vitals come after the growth wipe", lastIndex("__vitals_wiped_by_growth") < lastIndex("SetHealth"))
check("elder stacks after the last mutation push",
      lastIndex("SetReplicatedMutationsData") < firstIndex("SetElderReplicationStacks"))
check("FName objects written to slots, not strings", H.countCalls("field:MutationSlot1") >= 1)
check("slot 1 is free again", Storage.listSlots(STEAM)["1"] == nil)

print("\n-- 6. the stand-still test: 5 m, no damage — a failure costs no cooldown --")
writeSettings('{"storeCountdown":30,"cooldown":60,"maxSlots":5}')
clock = clock + 61                                       -- past section 5's redeem
local function storing()
  local p = H.makePawn({ growth = 0.7, gasVitals = true })
  local c = H.makeCtrl(STEAM, p)
  useCtrl(c)
  H.calls = {}
  return p, c, send("store")
end
-- a) walks away
local p6, c6, id6 = storing()
p6.__props.Loc = { X = 1 + 300, Y = 2, Z = 3 }          -- 3 m: still fine
guard.fn()
check("3 m away: still storing", final(id6) == nil)
p6.__props.Loc = { X = 1 + 520, Y = 2, Z = 3 }          -- 5.2 m
guard.fn()
check("past 5 m: failed at once, reason 'moved'", final(id6) and final(id6).ok == false and final(id6).reason == "moved",
      final(id6) and json.encode(final(id6)))
check("the player is told why, and that they may retry", lastMsg(c6):find("bán kính 5 m", 1, true) ~= nil
      and lastMsg(c6):find("cất lại ngay", 1, true) ~= nil, lastMsg(c6))
H.advance(31000)
check("nothing stored, dino not removed", H.countCalls("SetHealth") == 0 and next(Storage.listSlots(STEAM)) == nil)
local retry = send("store")
check("no cooldown after a failure: storing again works at once", started(retry) and started(retry).ok == true,
      started(retry) and json.encode(started(retry)))
-- b) deals damage (player-on-player hook)
H.fire(DAMAGE, H.param(p6), H.param(H.makePawn({})), H.param(25))
check("hitting someone fails it: 'damage_dealt'", final(retry) and final(retry).reason == "damage_dealt",
      final(retry) and json.encode(final(retry)))
-- c) takes damage (hook)
local p6c, _, id6c = storing()
H.fire(DAMAGE, H.param(H.makePawn({})), H.param(p6c), H.param(25))
check("being hit fails it: 'damage_taken'", final(id6c) and final(id6c).reason == "damage_taken")
-- d) loses health with no hook (AI bite, fall, bleeding)
local p6d, _, id6d = storing()
p6d.__props.Health = 99.5                                -- within 1 % of max: noise
guard.fn()
check("a tiny health wobble is not damage", final(id6d) == nil)
p6d.__props.Health = 90
guard.fn()
check("a real health drop fails it: 'damage_taken'", final(id6d) and final(id6d).reason == "damage_taken")
-- e) another dino's damage does not matter
local p6e, _, id6e = storing()
H.fire(DAMAGE, H.param(H.makePawn({})), H.param(H.makePawn({})), H.param(25))
check("damage between others: still storing", final(id6e) == nil)
H.advance(30100)
check("...and it completes", final(id6e) and final(id6e).ok == true)
check("a success does start the cooldown", (function()
  local id = send("store")
  return started(id) and started(id).ok == false and (started(id).messages[1] or ""):find("hồi", 1, true) ~= nil
end)())
for slot in pairs(Storage.listSlots(STEAM)) do Storage.discard(STEAM, slot) end
clock = clock + 61
writeSettings('{"storeCountdown":30,"cooldown":0}')

print("\n-- 7. slots are numbered; a slot name sent along is ignored; bad names never reach a redeem --")
Storage.put(STEAM, "1", { classPath = "X", growth = 1 })
local c7 = H.makeCtrl(STEAM, H.makePawn({ growth = 0.7 }))
useCtrl(c7)
local id7 = send("store", { slot = "mine" })
H.advance(30100)
check("next free number (2), not the name sent", final(id7) and final(id7).slot == "2"
      and Storage.get(STEAM, "mine") == nil, final(id7) and json.encode(final(id7)))
local bad = send("redeem", { slot = "../../etc/passwd" })
check("path traversal refused before anything runs", started(bad) and started(bad).error == "bad_arguments")
Storage.discard(STEAM, "1"); Storage.discard(STEAM, "2")

print("\n-- 8. the command runs for ITS SteamID, not for another player online --")
H.calls = {}
local OTHER = "76561198000000077"
local sender = H.makeCtrl(OTHER, H.makePawn({ growth = 0.6 }))
local bystander = H.makeCtrl(STEAM, H.makePawn({ growth = 0.9 }))
_G.FindAllOf = function() H.touch("FindAllOf"); return { bystander, sender } end
send("store", { steamId = OTHER })
H.advance(30100)
check("stored under that player's SteamID", Storage.get(OTHER, "1") ~= nil)
check("nothing stored for the other player", next(Storage.listSlots(STEAM)) == nil)
check("that player is the one told", lastMsg(sender):find("Đã cất", 1, true) ~= nil, lastMsg(sender))

print("\n-- 9. where a redeemed dino appears (panel setting + the player's choice) --")
local function setMode(mode)
  writeSettings('{"redeemAt":"' .. mode .. '","cooldown":0,"storeCountdown":30}')
end
-- A slot is used once, so each redeem gets a fresh one.
local function restock()
  Storage.put(STEAM, "default", { classPath = "BlueprintGeneratedClass /Game/BP_Dilo.BP_Dilo_C", growth = 0.8,
    location = { x = 1, y = 2, z = 3 }, rotation = { pitch = 0, yaw = 90, roll = 0 } })
end
local function redeem(fields)
  restock()
  H.calls = {}
  local c = H.makeCtrl(STEAM, H.makePawn({ growth = 0.05, mutation = "None" }))
  useCtrl(c)
  send("redeem", fields)
  H.advance(3100); H.advance(600)
  return c
end
local function teleportCall()
  for _, c in ipairs(H.calls) do if c.what == "K2_SetActorLocation" then return c end end
end

writeSettings('{"cooldown":0}')
redeem({ slot = "default" })
check("no redeemAt set = where the player stands", teleportCall() == nil)
setMode("stored")
redeem({ slot = "default" })
local tp = teleportCall()
check("stored: moved to the stored position (+30 lift)", tp ~= nil and tp.args[1].X == 1
      and tp.args[1].Y == 2 and tp.args[1].Z == 33, tp and (tp.args[1].X .. "," .. tp.args[1].Z) or "no teleport")
check("as a teleport, no sweep", tp ~= nil and tp.args[2] == false and tp.args[4] == true)
local order = H.callNames()
local function idx(n) for i, v in ipairs(order) do if v == n then return i end end end
check("moved before the state is applied", idx("K2_SetActorLocation") ~= nil and idx("SetGrowth") ~= nil
      and idx("K2_SetActorLocation") < idx("SetGrowth"))
setMode("choice")
redeem({ slot = "default", where = "here" })
check("choice + 'here' = where the player stands", teleportCall() == nil)
redeem({ slot = "default", where = "stored" })
check("choice + 'stored' = the stored spot", teleportCall() ~= nil)
redeem({ where = "stored" })
check("no slot = the most recent one", teleportCall() ~= nil)
setMode("current")
redeem({ slot = "default", where = "stored" })
check("current: the player's choice is ignored", teleportCall() == nil)
-- A slot made in the admin panel has no stored position.
setMode("stored")
Storage.put(STEAM, "nopos", { classPath = "BlueprintGeneratedClass /Game/BP_Dilo.BP_Dilo_C", growth = 0.5 })
local c9 = redeem({ slot = "nopos" })
check("no stored position: restored where the player stands", teleportCall() == nil and H.countCalls("SetGrowth") == 1)
local told = false
for _, m in ipairs(c9._messages) do if m:match("no stored position") then told = true end end
check("and the player is told why", told)
setMode("sideways")
redeem({ slot = "default" })
check("a broken setting falls back to 'current'", teleportCall() == nil)
os.remove(SETTINGS)

print("\n-- 10. a slot is used ONCE: no second copy from the same slot --")
writeSettings('{"cooldown":0,"storeCountdown":30}')
restock()
local c10 = H.makeCtrl(STEAM, H.makePawn({ growth = 0.05, mutation = "None" }))
useCtrl(c10)
send("redeem", { slot = "default" })
H.advance(10)
check("taken out at once, before the restore delay", Storage.get(STEAM, "default") == nil)
local twice = send("redeem", { slot = "default" })
check("a second redeem finds it empty", (started(twice).messages[1] or ""):match("empty or unreadable") ~= nil)
H.advance(3700)
check("only one restore ran", H.countCalls("SetGrowth") >= 1)
local hist = false
for name in io.popen('ls "Mods/DinoGarage/Saved/deleted"'):lines() do
  if name:match("__default__redeemed%-") then hist = true end
end
check("kept as history in deleted/", hist)

print("\n-- 11. leaving during the restore wait puts the slot back --")
restock()
local c11 = H.makeCtrl(STEAM, H.makePawn({ growth = 0.05, mutation = "None" }))
useCtrl(c11)
send("redeem", { slot = "default" })
H.advance(10)
_G.FindAllOf = function() H.touch("FindAllOf"); return {} end      -- player gone
H.advance(3200)
check("slot back in the garage", Storage.get(STEAM, "default") ~= nil)
Storage.discard(STEAM, "default")

print("\n-- 12. leaving during the store countdown stores nothing --")
local c12 = H.makeCtrl(STEAM, H.makePawn({ growth = 0.7 }))
useCtrl(c12)
H.calls = {}
local id12 = send("store")
H.advance(1000)
_G.FindAllOf = function() H.touch("FindAllOf"); return {} end      -- quits mid-countdown
guard.fn()
H.advance(30000)
check("no slot saved", next(Storage.listSlots(STEAM)) == nil)
check("no dino removed", H.countCalls("SetHealth") == 0)
check("the web is told: 'left'", final(id12) and final(id12).ok == false and final(id12).reason == "left")

print("\n-- 13. two slots per player by default --")
Storage.put(STEAM, "a1", { classPath = "X", growth = 1 })
Storage.put(STEAM, "a2", { classPath = "X", growth = 1 })
writeSettings('{"cooldown":0}')
local c13 = H.makeCtrl(STEAM, H.makePawn({ growth = 0.7 }))
useCtrl(c13)
local id13 = send("store")
check("third slot refused", (started(id13).messages[1] or ""):find("đầy (2 slot)", 1, true) ~= nil, started(id13).messages[1])
writeSettings('{"cooldown":0,"maxSlots":3,"storeCountdown":0}')
local id13b = send("store")
H.advance(10)
check("allowed when the panel raises the limit, as slot 1", final(id13b) and final(id13b).ok == true
      and Storage.get(STEAM, "1") ~= nil)
check("countdown 0 = stored at once", H.countCalls("SetHealth") >= 1)

print("\n-- 14. the garage cooldown between uses --")
for slot in pairs(Storage.listSlots(STEAM)) do Storage.discard(STEAM, slot) end
writeSettings('{"cooldown":60,"maxSlots":5,"storeCountdown":0}')
clock = clock + 61
local c14 = H.makeCtrl(STEAM, H.makePawn({ growth = 0.7 }))
useCtrl(c14)
send("store"); H.advance(10)
check("first use ok", Storage.get(STEAM, "1") ~= nil)
clock = clock + 10
local id14 = send("store"); H.advance(10)
check("second use within 60 s refused", Storage.get(STEAM, "2") == nil
      and (started(id14).messages[1] or ""):find("chờ 50 giây", 1, true) ~= nil, started(id14).messages[1])
clock = clock + 51
send("store"); H.advance(10)
check("allowed after the cooldown", Storage.get(STEAM, "2") ~= nil)

print("\n-- 15. an admin-made slot comes out with a full stomach --")
writeSettings('{"cooldown":0,"maxSlots":10}')
Storage.put(STEAM, "gift", { classPath = "BlueprintGeneratedClass /Game/BP_Dilo.BP_Dilo_C", growth = 1,
  createdBy = "admin", fill = { stomachFull = true, nutrientPct = 50 } })
local p15 = H.makePawn({ growth = 0.05, mutation = "None", gasVitals = true })
p15.__props.MaxHunger = 3135
useCtrl(H.makeCtrl(STEAM, p15))
H.calls = {}
send("redeem", { slot = "gift" })
H.advance(3100); H.advance(600)
local lastHunger
for _, cl in ipairs(H.calls) do if cl.what == "SetHunger" then lastHunger = cl.args[1] end end
check("stomach set to the game's max for this dino", lastHunger == 3135, tostring(lastHunger))
local filled = {}
for _, cl in ipairs(H.calls) do if cl.what:match("^field:") then filled[cl.what:sub(7)] = cl.args[1] end end
check("nutrients: nutrientPct of the stomach each (not pushed empty)", filled.CarbValue == 1567.5
      and filled.ProteinValue == 1567.5 and filled.LipidValue == 1567.5 and filled.bMalnutrition == false, json.encode(filled))
check("…and pushed", H.countCalls("SetNutrientsStruct") >= 1)

print("\n-- 15b. an admin-made slot: the stomach for the NEW growth (SetGrowth left the hatchling's) --")
Storage.put(STEAM, "rexgift", { classPath = "BlueprintGeneratedClass /Game/BP_Dilo.BP_Dilo_C", growth = 0.37,
  createdBy = "admin", fill = { stomachFull = true, nutrientPct = 50 } })
local rex = H.makePawn({ growth = 0.25, mutation = "None", gasVitals = true })
rex.__props.MaxHunger = 16.5
local grown = false
rawset(rex, "GetMaxHealth", function() return grown and 367 or 50 end)
rawset(rex, "SetGrowth", function(_, v) H.record("SetGrowth", v); grown = true end)   -- the stomach stays 16.5
useCtrl(H.makeCtrl(STEAM, rex))
H.calls = {}
send("redeem", { slot = "rexgift" })
H.advance(3100); H.advance(600)
local maxSet, fed
for _, cl in ipairs(H.calls) do
  if cl.what == "SetMaxHunger" then maxSet = cl.args[1] end
  if cl.what == "SetHunger" then fed = cl.args[1] end
end
local want = 16.5 / 50 * 367
check("stomach set from the species' ratio at the new growth", maxSet and math.abs(maxSet - want) < 0.01, tostring(maxSet))
check("filled to that stomach, not the hatchling's 16.5", fed and math.abs(fed - want) < 0.01, tostring(fed))
local carb
for _, cl in ipairs(H.calls) do if cl.what == "field:CarbValue" then carb = cl.args[1] end end
check("nutrients from that stomach too", carb and math.abs(carb - want / 2) < 0.01, tostring(carb))

print("\n-- 16. nutrients are kept by their REAL field names --")
for slot in pairs(Storage.listSlots(STEAM)) do Storage.discard(STEAM, slot) end
writeSettings('{"cooldown":0,"storeCountdown":30}')
local p16 = H.makePawn({ growth = 0.8, nutrients = { CarbohydrateValue = 120, ProteinValue = 80, LipidValue = 321.5 } })
useCtrl(H.makeCtrl(STEAM, p16))
local id16 = send("store")
H.advance(30100)
local slot16 = final(id16) and final(id16).slot
local st16 = slot16 and Storage.get(STEAM, slot16)
check("every reflected field stored", st16 and st16.nutrients.fields and st16.nutrients.fields.CarbohydrateValue == 120
      and st16.nutrients.fields.LipidValue == 321.5, st16 and json.encode(st16.nutrients) or "-")
local p16b = H.makePawn({ growth = 0.05, mutation = "None", nutrients = { CarbohydrateValue = 0, ProteinValue = 0, LipidValue = 0 } })
useCtrl(H.makeCtrl(STEAM, p16b))
H.calls = {}
send("redeem", { slot = slot16 })
H.advance(3100); H.advance(600)
local wrote = {}
for _, cl in ipairs(H.calls) do if cl.what:match("^field:") then wrote[cl.what] = cl.args[1] end end
check("written back under the same names", wrote["field:CarbohydrateValue"] == 120 and wrote["field:LipidValue"] == 321.5,
      json.encode(wrote))

print("\n-- 17. a prime elder is stored as prime (the web garage highlights it) --")
for slot in pairs(Storage.listSlots(STEAM)) do Storage.discard(STEAM, slot) end
writeSettings('{"cooldown":0,"storeCountdown":0}')
useCtrl(H.makeCtrl(STEAM, H.makePawn({ growth = 1, prime = true })))
local id17 = send("store")
H.advance(10)
local st17 = final(id17) and Storage.get(STEAM, final(id17).slot)
check("prime = true in the slot", st17 and st17.prime == true, st17 and tostring(st17.prime) or "no slot")

print("\n-- 18. an admin-made prime slot: eligible + elder stacks set, and the result logged --")
for slot in pairs(Storage.listSlots(STEAM)) do Storage.discard(STEAM, slot) end
writeSettings('{"cooldown":0,"storeCountdown":30}')
Storage.put(STEAM, "primegift", { classPath = "BlueprintGeneratedClass /Game/BP_Dilo.BP_Dilo_C", growth = 1,
  isPrime = true, elderStacks = 2, createdBy = "admin" })
H.calls = {}
H.log = {}
useCtrl(H.makeCtrl(STEAM, H.makePawn({ growth = 0.05, mutation = "None", prime = true, eligible = true })))
send("redeem", { slot = "primegift" })
H.advance(3100); H.advance(600)
local primeArg, stacksArg
for _, c in ipairs(H.calls) do
  if c.what == "ServerSetPrimeEligible" then primeArg = c.args[1] end
  if c.what == "SetElderReplicationStacks" then stacksArg = c.args[1] end
end
check("ServerSetPrimeEligible(true)", primeArg == true, tostring(primeArg))
check("SetElderReplicationStacks(2)", stacksArg == 2, tostring(stacksArg))
local reported = false
for _, l in ipairs(H.log) do if l:match("prime asked %-> eligible=true prime=true") then reported = true end end
check("what the game made of it is logged", reported, table.concat(H.log, " | "):sub(1, 300))

print("\n-- 19. the prime conditions go into the slot and come back; a stored prime comes back prime --")
for slot in pairs(Storage.listSlots(STEAM)) do Storage.discard(STEAM, slot) end
writeSettings('{"cooldown":0,"storeCountdown":0}')
local before = H.makePawn({ growth = 0.76, prime = true })
for i = 1, 10 do before.__prime["bPrimeCondition" .. i] = (i == 1 or i == 3 or i == 5 or i == 7 or i == 8) end
before.__prime.bIsEligiblePrime = true
useCtrl(H.makeCtrl(STEAM, before))
local id19 = send("store")
H.advance(10)
local st19 = final(id19) and Storage.get(STEAM, final(id19).slot)
check("conditions stored", st19 and st19.primeData and st19.primeData.cond5 == true and st19.primeData.cond2 == false
      and st19.primeData.eligible == true, st19 and json.encode(st19.primeData) or "no slot")
H.calls = {}
local after = H.makePawn({ growth = 0.05, mutation = "None" })
useCtrl(H.makeCtrl(STEAM, after))
send("redeem", { slot = final(id19).slot })
H.advance(3100); H.advance(600)
local got = {}
for i = 1, 10 do got[i] = after.__prime["bPrimeCondition" .. i] and "1" or "0" end
check("conditions written back (migration, patrol…)", table.concat(got) == "1010101100", table.concat(got))
check("eligible written back", after.__prime.bIsEligiblePrime == true)
local asked = false
for _, c in ipairs(H.calls) do if c.what == "ServerSetPrimeEligible" and c.args[1] == true then asked = true end end
check("a stored prime (\"prime\", not \"isPrime\") asks for prime back", asked)
check("the first-write flag is gone", io.open("Mods/DinoGarage/Saved/prime-write.trying", "r") == nil)

print("\n-- 20. prime fixes: applied once, on the right dino only --")
local fixLoop
for _, l in ipairs(H.gameLoops) do if l.ms == 5000 then fixLoop = l end end
check("a 5 s game-thread loop", fixLoop ~= nil)
local ff = assert(io.open("Mods/DinoGarage/Saved/prime-fixes.json", "w"))
ff:write(json.encode({ fixes = {
  { id = "fix1", steamId = STEAM, species = "BP_Triceratops_C", minGrowth = 0.55, maxGrowth = 0.65,
    primeData = { cond1 = true, cond2 = false, cond3 = true, cond5 = true, cond7 = true, cond8 = true, eligible = true },
    prime = false, expiresAt = clock + 3600 },
  { id = "old", steamId = STEAM, species = "BP_Triceratops_C", minGrowth = 0, maxGrowth = 1,
    primeData = { cond6 = true }, expiresAt = clock - 1 },
} }))
ff:close()
local wrong = H.makePawn({ growth = 0.60, class = "BlueprintGeneratedClass /Game/BP_Dilo.BP_Dilo_C" })
useCtrl(H.makeCtrl(STEAM, wrong))
fixLoop.fn()
check("another species: waits", wrong.__prime.bPrimeCondition5 == false and #eventsOf("prime_fix") == 0)
local trike = H.makePawn({ growth = 0.60, class = "BlueprintGeneratedClass /Game/BP_Triceratops.BP_Triceratops_C" })
trike.__prime.bPrimeCondition2 = true   -- gained since: a fix never takes it away
local trikeCtrl = H.makeCtrl(STEAM, trike)
useCtrl(trikeCtrl)
fixLoop.fn()
check("progress gained since is kept (only given, never taken)", trike.__prime.bPrimeCondition2 == true)
check("the right dino: conditions given back", trike.__prime.bPrimeCondition5 == true and trike.__prime.bIsEligiblePrime == true)
check("an expired fix is not applied", trike.__prime.bPrimeCondition6 == false)
check("an event and a message", #eventsOf("prime_fix") == 1 and eventsOf("prime_fix")[1].id == "fix1"
      and lastMsg(trikeCtrl):find("khôi phục tiến độ prime", 1, true) ~= nil, lastMsg(trikeCtrl))
trike.__prime.bPrimeCondition5 = false
fixLoop.fn()
check("once only", trike.__prime.bPrimeCondition5 == false and #eventsOf("prime_fix") == 1)

-- primeAt: every condition was there, so past 75 % it would have been prime.
local function primeAsked()
  for _, c in ipairs(H.calls) do if c.what == "ServerSetPrimeEligible" and c.args[1] == true then return true end end
  return false
end
local ff2 = assert(io.open("Mods/DinoGarage/Saved/prime-fixes.json", "w"))
ff2:write(json.encode({ fixes = {
  { id = "young", steamId = STEAM, species = "BP_Allosaurus_C", minGrowth = 0.6, maxGrowth = 1, primeAt = 0.75,
    primeData = { cond1 = true, cond6 = true, eligible = true }, expiresAt = clock + 3600 },
} }))
ff2:close()
H.calls = {}
local young = H.makePawn({ growth = 0.70, class = "BlueprintGeneratedClass /Game/BP_Allosaurus.BP_Allosaurus_C" })
useCtrl(H.makeCtrl(STEAM, young))
fixLoop.fn()
check("below primeAt: the conditions, no prime asked (the game decides at 75 %)", young.__prime.bPrimeCondition6 == true and not primeAsked())
os.remove("Mods/DinoGarage/Saved/prime-fixes.done.json")
-- (the mod keeps what it applied in memory: a fresh id for the grown case)
ff2 = assert(io.open("Mods/DinoGarage/Saved/prime-fixes.json", "w"))
ff2:write(json.encode({ fixes = {
  { id = "grown", steamId = STEAM, species = "BP_Allosaurus_C", minGrowth = 0.6, maxGrowth = 1, primeAt = 0.75,
    primeData = { cond1 = true, cond6 = true, eligible = true }, expiresAt = clock + 3600 },
} }))
ff2:close()
H.calls = {}
local grown = H.makePawn({ growth = 0.82, class = "BlueprintGeneratedClass /Game/BP_Allosaurus.BP_Allosaurus_C" })
useCtrl(H.makeCtrl(STEAM, grown))
fixLoop.fn()
check("past primeAt: prime asked too (it would have turned prime at 75 %)", grown.__prime.bPrimeCondition6 == true and primeAsked())
os.remove("Mods/DinoGarage/Saved/prime-fixes.json"); os.remove("Mods/DinoGarage/Saved/prime-fixes.done.json")

say("")
say("-- threads: nothing the mod ran from an async callback touched the engine --")
check("no engine access off the game thread", H.offThreadAccess == 0, table.concat(H.offThreadWhat, ", "))

say(string.format("=== DinoGarage: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
