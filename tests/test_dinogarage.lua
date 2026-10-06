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
local pawn = H.makePawn({ growth = 0.9, mutation = "MUT_Life", gasVitals = true,
  unlocks = { "Traumatic Thrombosis", "Reniculate Kidneys" } })      -- drank enough saltwater
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
  check("the quest-unlocked mutations stored (drink saltwater…)", type(state.unlockedMutations) == "table"
        and state.unlockedMutations[2] == "Reniculate Kidneys", json.encode(state.unlockedMutations))
  check("elder stacks captured", state.elderStacks == 3, tostring(state.elderStacks))
  check("skin captured with the slot", state.skin and state.skin.colors.Body and state.skin.patternIndex == 3,
        state.skin and "ok" or "no skin")
  check("nutrients captured", state.nutrients.carbValue == 5, tostring(state.nutrients.carbValue))
end

print("\n-- 3. the kill used 0 health --")
check("killed with 0", H.calls[#H.calls].args[1] == 0, tostring(H.calls[#H.calls].args[1]))

print("\n-- 3b. a redeem onto the store's own corpse is refused; the slot stays --")
-- Dev-Lucii 2026-10-04: redeem 6 s after a store (cooldown 2 s), still on the corpse: the slot was
-- restored onto it and the dino was gone.
do
  H.calls = {}
  local idC = send("redeem", { slot = "1" })
  H.advance(4000)
  check("refused: respawn first", started(idC) and started(idC).ok == false
        and (started(idC).messages[1] or ""):match("Respawn first") ~= nil, started(idC) and json.encode(started(idC)))
  check("nothing restored onto the corpse", H.countCalls("SetGrowth") == 0, "SetGrowth x" .. H.countCalls("SetGrowth"))
  check("the slot is still in the garage", io.open(RUN .. "/Mods/DinoGarage/Saved/stored/" .. STEAM .. "__1.json", "r") ~= nil)
end

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
local freshPawn = H.makePawn({ growth = 0.05, mutation = "None" })
freshPawn.ReplicatedMutationsData.MutationSlot2 = FName("Hemomania")       -- picked in the spawn screen
freshPawn.ReplicatedMutationsData.ParentMutationSlot2 = FName("Hydrodynamic") -- a nest-born dino's own
freshPawn.__skin.BodyColor = { R = 0, G = 0, B = 0, A = 1 }       -- the new dino's own paint
freshPawn.__skin.PatternIndex = 1
local freshCtrl = H.makeCtrl(STEAM, freshPawn)
useCtrl(freshCtrl)
send("redeem", { slot = "1" })
H.advance(10)
check("restore deferred, nothing applied yet", H.countCalls("SetGrowth") == 0)
do
  -- Before anything is restored: what the bridge needs to put the slot back after a crash.
  local starts = eventsOf("garage_redeem_start")
  local s = starts[#starts]
  local file = s and s.file or ""
  check("garage_redeem_start emitted at once: slot, species, growth, the history file",
    s ~= nil and s.steamId == STEAM and s.slot == "1" and type(s.species) == "string" and s.growth == 0.9
    and file:match("^" .. STEAM .. "__1__redeemed%-%d+%.json$") ~= nil, s and json.encode(s))
  check("…and that history file is where the slot went", io.open("Mods/DinoGarage/Saved/deleted/" .. file, "r") ~= nil, file)
  check("…before any garage_redeem result", #eventsOf("garage_redeem") == 0, tostring(#eventsOf("garage_redeem")))
end
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
check("the stored colours are painted back", freshPawn.__skin.BodyColor.R == 0.5 and freshPawn.__skin.BodyColor.G == 0.25
      and freshPawn.__skin.PatternIndex == 3, json.encode(freshPawn.__skin.BodyColor))
local names = H.callNames()
local function firstIndex(n) for i, v in ipairs(names) do if v == n then return i end end end
local function lastIndex(n) local r; for i, v in ipairs(names) do if v == n then r = i end end return r end
check("SetGrowth precedes the final SetHealth", firstIndex("SetGrowth") < lastIndex("SetHealth"))
check("final vitals come after the growth wipe", lastIndex("__vitals_wiped_by_growth") < lastIndex("SetHealth"))
check("elder stacks after the last mutation push",
      lastIndex("SetReplicatedMutationsData") < firstIndex("SetElderReplicationStacks"))
check("FName objects written to slots, not strings", H.countCalls("field:MutationSlot1") >= 1)
check("a slot the stored dino had empty is emptied (not the fresh dino's pick)",
      freshPawn.ReplicatedMutationsData.MutationSlot2:ToString() == "None"
      and freshPawn.ReplicatedMutationsData.ParentMutationSlot2:ToString() == "None",
      freshPawn.ReplicatedMutationsData.MutationSlot2:ToString() .. " / " .. freshPawn.ReplicatedMutationsData.ParentMutationSlot2:ToString())
check("…and the stored ones are there", freshPawn.ReplicatedMutationsData.MutationSlot1:ToString() == "MUT_Life"
      and freshPawn.ReplicatedMutationsData.ParentMutationSlot1:ToString() == "MUT_Parent")
check("the unlocked quest mutation given back (+ the slots' own, inherited too), none duplicated",
      table.concat(freshPawn.MutationsRequirementsData.UnlockRequiredMutations.__names, ",") == "Traumatic Thrombosis,Reniculate Kidneys,MUT_Life,MUT_Parent",
      table.concat(freshPawn.MutationsRequirementsData.UnlockRequiredMutations.__names, ","))
do
  local Restore = require("garage.restore")
  -- Stored before the list was kept (or made by an admin): the slots' mutations count as unlocked.
  check("an old slot: its slot mutations (active and inherited) become the unlocked list",
        table.concat(Restore.unlocksFor({ mutations = { Slot1 = "Hydrodynamic", Slot3 = "Reniculate Kidneys", ParentSlot1 = "X" } }), ",")
        == "Hydrodynamic,Reniculate Kidneys,X")
end
check("…pushed, before the active slots, then the mutation list redrawn",
      H.countCalls("SetMutationRequirementsData") == 1 and H.countCalls("ClientUpdateMutations") == 1
      and firstIndex("SetMutationRequirementsData") < lastIndex("SetReplicatedMutationsData")
      and lastIndex("SetReplicatedMutationsData") < firstIndex("ClientUpdateMutations"))
check("the unlock-write flag is gone", io.open("Mods/DinoGarage/Saved/unlock-write.trying", "r") == nil)
check("slot 1 is free again", Storage.listSlots(STEAM)["1"] == nil)

print("\n-- 6. the stand-still test: 5 m, no damage, a failure costs no cooldown --")
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

print("\n-- 6f. prison (mods/Prison): an inmate cannot store or redeem; jailed mid-countdown fails it --")
do
  local Prison = require("shared.isle.prison")
  os.execute('mkdir -p "' .. RUN .. '/Mods/shared"')
  local function jailed(on)
    if on then
      local pf = assert(io.open(Prison.PATH, "w")); pf:write('{"inmates":["' .. STEAM .. '"]}'); pf:close()
    else os.remove(Prison.PATH) end
    Prison.reset()
  end
  clock = clock + 61
  jailed(true)
  local _, _, idS = storing()
  check("an inmate's store is refused, no countdown", started(idS) and started(idS).ok == false
    and (started(idS).messages[1] or ""):find("ở tù", 1, true) ~= nil, started(idS) and json.encode(started(idS)))
  local idR = send("redeem", { slot = "1" })
  check("an inmate's redeem is refused", started(idR) and started(idR).ok == false
    and (started(idR).messages[1] or ""):find("ở tù", 1, true) ~= nil, started(idR) and json.encode(started(idR)))
  jailed(false)
  local _, cJ, idJ = storing()
  check("not an inmate: the store starts", started(idJ) and started(idJ).ok == true)
  jailed(true)
  guard.fn()
  check("jailed during the countdown: failed, reason 'prison'", final(idJ) and final(idJ).ok == false and final(idJ).reason == "prison",
    final(idJ) and json.encode(final(idJ)))
  check("…and told why", lastMsg(cJ):find("ở tù", 1, true) ~= nil, lastMsg(cJ))
  H.advance(31000)
  check("nothing stored, dino not removed", H.countCalls("SetHealth") == 0)
  jailed(false)
end

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

print("\n-- 13. three slots per plain player by default (owner, 2026-10-05) --")
Storage.put(STEAM, "a1", { classPath = "X", growth = 1 })
Storage.put(STEAM, "a2", { classPath = "X", growth = 1 })
Storage.put(STEAM, "a3", { classPath = "X", growth = 1 })
writeSettings('{"cooldown":0}')
local c13 = H.makeCtrl(STEAM, H.makePawn({ growth = 0.7 }))
useCtrl(c13)
local id13 = send("store")
check("fourth slot refused", (started(id13).messages[1] or ""):find("đầy (3 slot)", 1, true) ~= nil, started(id13).messages[1])
writeSettings('{"cooldown":0,"maxSlots":4,"storeCountdown":0}')
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

print("\n-- 14b. by member tier: VIP 5 slots / 120 s, SVip no limit / 60 s, admin no limit / no wait --")
do
  local Settings = require("garage.settings")
  writeSettings('{"maxSlots":3,"cooldown":180,"tiers":{"vip":{"maxSlots":5,"cooldown":120},"svip":{"maxSlots":0,"cooldown":60}},' ..
    '"members":{"76561198000000071":"vip","76561198000000072":"svip","76561198000000073":"admin","76561198000000074":"boss"}}')
  local s = Settings.read()
  local function rule(id) local r = Settings.forPlayer(s, id); return r.tier .. " " .. tostring(r.maxSlots) .. " " .. r.cooldown end
  check("a plain player: 3 slots, 180 s", rule(STEAM) == "normal 3 180", rule(STEAM))
  check("VIP: 5 slots, 120 s", rule("76561198000000071") == "vip 5 120", rule("76561198000000071"))
  check("SVip: no limit, 60 s", rule("76561198000000072") == "svip nil 60", rule("76561198000000072"))
  check("admin: no limit, no wait", rule("76561198000000073") == "admin nil 0", rule("76561198000000073"))
  check("an unknown tier is a plain player", rule("76561198000000074") == "normal 3 180", rule("76561198000000074"))
  -- An SVip with 6 dinos stores a 7th; a plain player at 3 cannot.
  local SV = "76561198000000072"
  for i = 1, 6 do Storage.put(SV, "s" .. i, { classPath = "X", growth = 1 }) end
  writeSettings('{"maxSlots":3,"cooldown":180,"storeCountdown":0,"members":{"' .. SV .. '":"svip"}}')
  local csv = H.makeCtrl(SV, H.makePawn({ growth = 0.7 }))
  useCtrl(csv)
  local idv = send("store", { steamId = SV }); H.advance(10)
  check("SVip: a 7th dino stored (no limit)", final(idv) and final(idv).ok == true, started(idv) and started(idv).messages[1])
  clock = clock + 30
  local idw = send("store", { steamId = SV }); H.advance(10)
  check("SVip: 30 s later, still waiting (60 s)", (started(idw).messages[1] or ""):find("chờ 30 giây", 1, true) ~= nil, started(idw).messages[1])
  for slot in pairs(Storage.listSlots(SV)) do Storage.discard(SV, slot) end
end

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

print("\n-- 15c. a T-Rex stored with a stomach off its share (the 2026-10-05 vomit) comes out with the right one --")
do
  local REXC = "BlueprintGeneratedClass /Game/TheIsle/Core/Characters/Dinosaurs/Tyrannosaurus/BP_Tyrannosaurus.BP_Tyrannosaurus_C"
  -- Stored at 52 % with a 1,725 stomach (an old growth write) and 1,588 food (92 % of it).
  Storage.put(STEAM, "bigbelly", { classPath = REXC, growth = 0.52, health = 3108.8, maxHealth = 3108.8,
    hunger = 1588.0, maxHunger = 1724.8, thirst = 800, stamina = 500 })
  local r = H.makePawn({ growth = 0.25, mutation = "None", gasVitals = true, class = REXC })
  r.__props.MaxHunger = 16.5
  local grown = false
  rawset(r, "GetMaxHealth", function() return grown and 3108.8 or 50 end)
  rawset(r, "SetGrowth", function(_, v) H.record("SetGrowth", v); grown = true end)
  useCtrl(H.makeCtrl(STEAM, r))
  H.calls = {}
  send("redeem", { slot = "bigbelly" })
  H.advance(3100); H.advance(600)
  local maxSet, fed
  for _, cl in ipairs(H.calls) do
    if cl.what == "SetMaxHunger" then maxSet = cl.args[1] end
    if cl.what == "SetHunger" then fed = cl.args[1] end
  end
  local want = 0.33 * 3108.8
  check("stomach = the T-Rex share of max health (1,025.9), not the stored 1,724.8", maxSet and math.abs(maxSet - want) < 0.01, tostring(maxSet))
  check("food = its stored share (92 %) of that, under 100 %", fed and math.abs(fed - want * 1588.0 / 1724.8) < 0.01 and fed <= want,
    tostring(fed))
end

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
do
  -- Prime's stats come with a stat recompute (SetGrowth): the growth is set once more after prime,
  -- then the vitals it wiped (a prime Deinosuchus came out with a plain one's max health, 2026-09-28).
  local names = H.callNames()
  local lastPrime, growths, lastGrowth, lastHealth = 0, 0, 0, 0
  for i, n in ipairs(names) do
    if n == "ServerSetPrimeEligible" then lastPrime = i end
    if n == "SetGrowth" then growths = growths + 1; lastGrowth = i end
    if n == "SetMaxHunger" then lastHealth = i end   -- the stomach, recomputed from the new max health
  end
  -- This fake's max health never moves, so the same growth again "did nothing": down to 0.5
  -- and back too (restore.lua R.primeGrowth, 19b3), 4 growth writes, the last one 1.
  local growthArgs = {}
  for _, c in ipairs(H.calls) do if c.what == "SetGrowth" then growthArgs[#growthArgs + 1] = tostring(c.args[1]) end end
  check("a prime dino: the growth set again after prime, the stomach / vitals after that", growths == 4
        and table.concat(growthArgs, " ") == "1 1 0.5 1"
        and lastGrowth > lastPrime and lastHealth > lastGrowth,
        growths .. " / " .. lastPrime .. " / " .. lastGrowth .. " / " .. lastHealth .. " / " .. table.concat(growthArgs, " "))
  local logged = false
  for _, l in ipairs(H.log) do if l:find("prime stats, max health", 1, true) then logged = true end end
  check("…and logged", logged)
end

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
check("the game did not make it prime (this fake): the growth is not set again", H.countCalls("SetGrowth") == 1,
      "SetGrowth x" .. H.countCalls("SetGrowth"))
check("the first-write flag is gone", io.open("Mods/DinoGarage/Saved/prime-write.trying", "r") == nil)

print("\n-- 19b. a long-time prime comes out: stomach and health as shares of the game's max, not the old numbers --")
-- Stored after a long prime: max health and stomach had grown (×1.31 on a Rex). The dino taken out
-- is a fresh prime with a lower max. Written back as numbers, the stomach stood above 100 % once the
-- game recomputed its max, and health above max was cut (2026-10-01).
for slot in pairs(Storage.listSlots(STEAM)) do Storage.discard(STEAM, slot) end
writeSettings('{"cooldown":0}')
Storage.put(STEAM, "oldprime", { classPath = "BlueprintGeneratedClass /Game/BP_Dilo.BP_Dilo_C", growth = 1, prime = true,
  health = 12274, maxHealth = 12274, hunger = 1100, maxHunger = 1227.4, blood = 12274 })
local fresh19b = H.makePawn({ growth = 0.05, mutation = "None", prime = true, eligible = true, gasVitals = true })
fresh19b.__props.MaxHunger = 10                       -- a hatchling: stomach 10 for max health 100
local growthWrites = 0
rawset(fresh19b, "GetMaxHealth", function()
  if growthWrites == 0 then return 100 elseif growthWrites == 1 then return 9000 else return 10860 end
end)
rawset(fresh19b, "SetGrowth", function(_, v) H.record("SetGrowth", v); growthWrites = growthWrites + 1 end)
useCtrl(H.makeCtrl(STEAM, fresh19b))
H.calls = {}
H.log = {}
send("redeem", { slot = "oldprime" })
H.advance(3100); H.advance(600)
local lastMax, lastFood, lastHp
for _, cl in ipairs(H.calls) do
  if cl.what == "SetMaxHunger" then lastMax = cl.args[1] end
  if cl.what == "SetHunger" then lastFood = cl.args[1] end
  if cl.what == "SetHealth" then lastHp = cl.args[1] end
end
check("prime regrow ran (the max health the game gives now: 10,860)", growthWrites == 2, tostring(growthWrites))
check("stomach max = the species' ratio × that max health, not the stored 1,227.4",
      lastMax and math.abs(lastMax - 1086) < 0.01, tostring(lastMax))
check("stomach = the same share as stored (89.6 %), never above its max",
      lastFood and math.abs(lastFood - 1100 / 1227.4 * 1086) < 0.01 and lastFood <= lastMax, tostring(lastFood))
check("health full as stored, on the new max, not 12,274 above a 10,860 max",
      lastHp and math.abs(lastHp - 10860) < 0.01, tostring(lastHp))
local vitalsLine = false
for _, l in ipairs(H.log) do if l:find("restore: vitals now", 1, true) then vitalsLine = true end end
check("every vital against its max logged once the restore is done", vitalsLine)
print("\n-- 19b2. blood and oxygen come back as shares too (stored plain, out prime: no 76 % blood) --")
-- Quang Tèo 2026-10-02 20:23: stored with a plain max 9,350 (blood 9,350), came out prime
-- (12,274): health 12,274/12,274 but blood written as 9,350 → bleeding, dark screen.
for slot in pairs(Storage.listSlots(STEAM)) do Storage.discard(STEAM, slot) end
Storage.put(STEAM, "plainmax", { classPath = "BlueprintGeneratedClass /Game/BP_Dilo.BP_Dilo_C", growth = 1,
  health = 9350, maxHealth = 9350, blood = 9350, oxygen = 450, maxOxygen = 900, hunger = 100, maxHunger = 200 })
local fresh19b2 = H.makePawn({ growth = 0.05, mutation = "None" })
fresh19b2.__props.MaxHealth, fresh19b2.__props.MaxBlood, fresh19b2.__props.MaxOxygen = 12274, 12274, 1000
useCtrl(H.makeCtrl(STEAM, fresh19b2))
H.calls = {}
send("redeem", { slot = "plainmax" })
H.advance(3100); H.advance(600)
local lastBlood, lastOxygen
for _, cl in ipairs(H.calls) do
  if cl.what == "SetBlood" then lastBlood = cl.args[1] end
  if cl.what == "SetOxygen" then lastOxygen = cl.args[1] end
end
check("blood full as stored (no maxBlood: health's max), on the new max, not 9,350 of 12,274",
      lastBlood and math.abs(lastBlood - 12274) < 0.01, tostring(lastBlood))
check("oxygen the same share as stored (50 %) of the new max", lastOxygen and math.abs(lastOxygen - 500) < 0.01, tostring(lastOxygen))
print("\n-- 19b3. a prime out of the garage onto a dino spawned a while before: down below the prime mark and back --")
-- Quang Tèo 2026-10-02 20:14: the spawned T-Rex had been played 8 min; the same growth again after
-- prime kept the plain max (9,350). PrimeLab: only a growth below 75 % and back adds prime's (12,274).
for slot in pairs(Storage.listSlots(STEAM)) do Storage.discard(STEAM, slot) end
Storage.put(STEAM, "aged", { classPath = "BlueprintGeneratedClass /Game/BP_Dilo.BP_Dilo_C", growth = 0.89, prime = true,
  health = 6137, maxHealth = 12274, blood = 12274, maxBlood = 12274, hunger = 2025, maxHunger = 4050 })
local aged = H.makePawn({ growth = 0.25, mutation = "None", prime = true, eligible = true })
local agedMax, wentLow = 50, false
rawset(aged, "GetMaxHealth", function() return agedMax end)
rawset(aged, "GetMaxBlood", function() return agedMax end)
rawset(aged, "SetGrowth", function(_, v)
  H.record("SetGrowth", v)
  if v < 0.75 then wentLow = true; agedMax = 2800
  elseif wentLow then agedMax = 12274          -- back above the mark from below: prime's stats
  else agedMax = 9350 end                       -- the same growth again: the plain max stays
end)
useCtrl(H.makeCtrl(STEAM, aged))
H.calls = {}
H.log = {}
send("redeem", { slot = "aged" })
H.advance(3100); H.advance(600)
local agedGrowths = {}
for _, cl in ipairs(H.calls) do if cl.what == "SetGrowth" then agedGrowths[#agedGrowths + 1] = tostring(cl.args[1]) end end
check("growth: as stored, again (no effect), down to 0.5, as stored", table.concat(agedGrowths, " ") == "0.89 0.89 0.5 0.89",
      table.concat(agedGrowths, " "))
check("prime's max health now (12,274)", agedMax == 12274, tostring(agedMax))
local agedHp, agedBlood
for _, cl in ipairs(H.calls) do
  if cl.what == "SetHealth" then agedHp = cl.args[1] end
  if cl.what == "SetBlood" then agedBlood = cl.args[1] end
end
check("health the share it was stored with (50 %) of prime's max", agedHp and math.abs(agedHp - 6137) < 0.01, tostring(agedHp))
check("blood full of prime's max", agedBlood and math.abs(agedBlood - 12274) < 0.01, tostring(agedBlood))
local dipLine = false
for _, l in ipairs(H.log) do if l:find("9350 -> 12274 (growth down to 0.5 and back)", 1, true) then dipLine = true end end
check("logged: the dip was needed", dipLine)

do
  local Capture = require("garage.capture")
  local p = H.makePawn({ growth = 1 })
  local st = Capture.capture(p)
  check("max blood and max oxygen captured", st and st.maxBlood == 100 and st.maxOxygen == 100,
        st and (tostring(st.maxBlood) .. "/" .. tostring(st.maxOxygen)) or "nil")
end

do
  local Restore = require("garage.restore")
  check("scaled: a share of the stored max on the new max", Restore.scaled(50, 200, 80) == 20)
  check("scaled: no stored max, capped at the new max", Restore.scaled(500, nil, 80) == 80 and Restore.scaled(30, nil, 80) == 30)
  check("scaled: new max unreadable, the value as stored", Restore.scaled(500, 600, nil) == 500)
  check("scaled: never above full", Restore.scaled(700, 600, 80) == 80)
end

print("\n-- 19c. the originals a Heal resets to are this dino's maxima, not the hatchling's --")
-- The game puts the maxima back to OriginalMaxHunger / Thirst / Stamina (the attribute set)
-- on an admin's Heal; a garage dino spawned as a hatchling kept a 2.0 stomach there and went
-- from 5,154 to 34 on a Heal (2026-10-01). Written after the restore, on its own set only.
do
  for slot in pairs(Storage.listSlots(STEAM)) do Storage.discard(STEAM, slot) end
  writeSettings('{"cooldown":0}')
  Storage.put(STEAM, "trike", { classPath = "BlueprintGeneratedClass /Game/BP_Dilo.BP_Dilo_C", growth = 0.78,
    health = 7390, maxHealth = 10307, hunger = 5035, maxHunger = 5154, thirst = 996, maxThirst = 1000, maxStamina = 1000 })
  local fresh = H.makePawn({ growth = 0.05, mutation = "None", gasVitals = true })
  fresh.__props.MaxHunger = 2
  for _, v in ipairs({ "MaxHunger", "MaxThirst", "MaxStamina" }) do
    rawset(fresh, "Set" .. v, function(_, x) H.record("Set" .. v, x); fresh.__props[v] = x end)
  end
  -- As the game: growth raises the max health (and refills it), not the stomach max.
  rawset(fresh, "SetGrowth", function(_, g) H.record("SetGrowth", g); fresh.__props.Growth = g; fresh.__props.MaxHealth = 10307; fresh.__props.Health = 10307 end)
  local attr = function(v) return { BaseValue = v, CurrentValue = v } end
  local mine = { OriginalMaxHunger = attr(2), OriginalMaxThirst = attr(1000), OriginalMaxStamina = attr(100),
    GetOuter = function() return fresh end }
  local other = { OriginalMaxHunger = attr(7), OriginalMaxThirst = attr(7), OriginalMaxStamina = attr(7),
    GetOuter = function() return H.makePawn({}) end }
  useCtrl(H.makeCtrl(STEAM, fresh))
  local base = _G.FindAllOf
  _G.FindAllOf = function(cls) if cls == "TIAttributeSetDinosaur" then return { other, mine } end; return base(cls) end
  H.log = {}
  send("redeem", { slot = "trike" })
  H.advance(3100); H.advance(600)
  local maxHunger = fresh.__props.MaxHunger
  check("the stomach max was set for the grown dino (not the hatchling's 2)", maxHunger > 100, tostring(maxHunger))
  check("OriginalMaxHunger = that stomach max (base and current)",
    mine.OriginalMaxHunger.BaseValue == maxHunger and mine.OriginalMaxHunger.CurrentValue == maxHunger, tostring(mine.OriginalMaxHunger.BaseValue))
  check("OriginalMaxThirst and OriginalMaxStamina = the maxima now",
    mine.OriginalMaxThirst.BaseValue == fresh.__props.MaxThirst and mine.OriginalMaxStamina.BaseValue == fresh.__props.MaxStamina,
    tostring(mine.OriginalMaxThirst.BaseValue) .. " / " .. tostring(mine.OriginalMaxStamina.BaseValue))
  check("another dino's attribute set is left alone", other.OriginalMaxHunger.BaseValue == 7 and other.OriginalMaxThirst.BaseValue == 7)
  local logged = false
  for _, l in ipairs(H.log) do if l:find("restore: originals OriginalMaxHunger=", 1, true) then logged = true end end
  check("logged: the originals written", logged)
  _G.FindAllOf = base
end

print("\n-- 19d. a prime the game turns prime a few seconds late: its stats worked out once more --")
-- A Carnotaurus came out with a plain max health (1,300) and got prime's (1,800) only at the
-- next login: IsPrimeElder said no right after the restore, prime a few seconds later (2026-10-01).
do
  for slot in pairs(Storage.listSlots(STEAM)) do Storage.discard(STEAM, slot) end
  writeSettings('{"cooldown":0}')
  Storage.put(STEAM, "lateprime", { classPath = "BlueprintGeneratedClass /Game/BP_Dilo.BP_Dilo_C", growth = 0.95, prime = true,
    health = 1800, maxHealth = 1800, hunger = 300, maxHunger = 600, primeData = { eligible = true } })
  local fresh = H.makePawn({ growth = 0.05, mutation = "None", gasVitals = true })
  local primeNow = false
  rawset(fresh, "IsPrimeElder", function() return primeNow end)
  local growthWrites = 0
  rawset(fresh, "SetGrowth", function(_, g)
    H.record("SetGrowth", g); growthWrites = growthWrites + 1
    fresh.__props.Growth = g; fresh.__props.MaxHealth = primeNow and 1800 or 1300; fresh.__props.Health = fresh.__props.MaxHealth
  end)
  for _, v in ipairs({ "MaxHunger", "Hunger" }) do rawset(fresh, "Set" .. v, function(_, x) H.record("Set" .. v, x); fresh.__props[v] = x end) end
  useCtrl(H.makeCtrl(STEAM, fresh))
  H.log = {}
  send("redeem", { slot = "lateprime" })
  H.advance(3100); H.advance(600)
  check("not prime yet at the restore: a plain max health (1,300), one growth write", fresh.__props.MaxHealth == 1300 and growthWrites == 1,
    fresh.__props.MaxHealth .. " / " .. growthWrites)
  fresh.__props.Health = 1300 * 0.9                      -- the player took a hit meanwhile: 90 %
  primeNow = true                                        -- the game turns it prime
  H.advance(5100)
  check("prime now: the growth written once more → prime's max health (1,800)", growthWrites == 2 and fresh.__props.MaxHealth == 1800,
    growthWrites .. " / " .. fresh.__props.MaxHealth)
  check("health kept at the share it had (90 %), not refilled", math.abs(fresh.__props.Health - 1620) < 0.01, tostring(fresh.__props.Health))
  local said = false
  for _, l in ipairs(H.log) do if l:find("prime came late", 1, true) then said = true end end
  check("logged: prime came late", said)
  -- Already prime at the restore: no second look.
  H.log = {}
  Storage.put(STEAM, "lateprime2", { classPath = "BlueprintGeneratedClass /Game/BP_Dilo.BP_Dilo_C", growth = 0.95, prime = true,
    health = 1800, maxHealth = 1800, hunger = 300, maxHunger = 600, primeData = { eligible = true } })
  growthWrites = 0
  clock = clock + 1
  send("redeem", { slot = "lateprime2" })
  H.advance(3100); H.advance(600); H.advance(5100)
  local late = false
  for _, l in ipairs(H.log) do if l:find("prime came late", 1, true) or l:find("still not prime", 1, true) then late = true end end
  -- Prime from the start in this fake: the max is prime's after the first write already, the same
  -- growth again does not move it, so down to 0.5 and back as well (4 writes), never the late look.
  check("prime at once: the usual regrow, no late look", growthWrites == 4 and not late, growthWrites .. " / " .. tostring(late))
end

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
      and lastMsg(trikeCtrl):find("cập nhật tiến độ prime", 1, true) ~= nil, lastMsg(trikeCtrl))
trike.__prime.bPrimeCondition5 = false
fixLoop.fn()
check("once only", trike.__prime.bPrimeCondition5 == false and #eventsOf("prime_fix") == 1)
do
  local decodes, decode = 0, json.decode
  json.decode = function(...) decodes = decodes + 1; return decode(...) end
  fixLoop.fn(); fixLoop.fn()
  json.decode = decode
  check("the file unchanged: not decoded again (it held the game thread ~7 ms every 5 s)", decodes == 0, decodes .. " decodes")
end

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

say("\n-- skin from the web: written field by field onto the dino played now --")
local function sendSkin(skin, sid)
  nextId = nextId + 1
  local c = { id = nextId, type = "skin", steamId = sid or STEAM, createdAt = clock, expiresAt = clock + 600, skin = skin }
  local fs = assert(io.open("Mods/DinoGarage/Saved/inbox.json", "w"))
  fs:write(json.encode({ commands = { c } })); fs:close()
  poll.fn()
  return nextId
end
local painted = H.makePawn({ growth = 0.5 })
local paintCtrl = H.makeCtrl(STEAM, painted)
useCtrl(paintCtrl)
os.remove("Mods/DinoGarage/Saved/skin-write.trying")
local sid = sendSkin({ colors = { Body = { r = 0.9, g = 0.1, b = 0.2 }, Underbelly = { r = 0, g = 0.5, b = 1 } }, pattern = 2, theme = 1, variation = 5 })
local sk = painted.__skin
check("colours written into CustomizerData", sk.BodyColor.R == 0.9 and sk.BodyColor.G == 0.1 and sk.BodyColor.B == 0.2
      and sk.UnderbellyColor.B == 1, json.encode(sk.BodyColor))
check("pattern, theme, variation written", sk.PatternIndex == 2 and sk.ThemeIndex == 1 and sk.SkinVariation == 5)
check("the player is told, the web gets ok", started(sid) and started(sid).ok == true and lastMsg(paintCtrl):find("Đã đổi màu", 1, true) ~= nil,
      lastMsg(paintCtrl))
check("no struct passed by value (no SetCustomizerData call)", H.countCalls("SetCustomizerData") == 0)
check("the crash flag is down after the first write", io.open("Mods/DinoGarage/Saved/skin-write.trying", "r") == nil)
local bad = sendSkin({ colors = { Body = { r = 12, g = 0, b = 0 } } })
check("a channel past 10 is refused, nothing written", started(bad) and started(bad).ok == false and sk.BodyColor.R == 0.9)
local hdr = sendSkin({ colors = { Body = { r = 3, g = 0.5, b = 0 } } })
check("HDR (above 1, up to 10) is written: the bridge decides what players may send", started(hdr) and started(hdr).ok == true and sk.BodyColor.R == 3)
local mudSet = nil
local fxStruct = { WetAmount = 0, MudAmount = 0 }
rawset(painted, "SetMudAmount", function(_, v) mudSet = v end)
rawset(painted, "SkinEffects", fxStruct)
local fxId = sendSkin({ colors = { Body = { r = 0.5, g = 0.5, b = 0.5 } }, effects = { Mud = 0.8, Wet = 0.6 } })
check("mud through the game's SetMudAmount, wet into the SkinEffects field", started(fxId) and started(fxId).ok == true
      and mudSet == 0.8 and fxStruct.WetAmount == 0.6 and fxStruct.MudAmount == 0)
local badFx = sendSkin({ colors = { Body = { r = 0.5, g = 0.5, b = 0.5 } }, effects = { Vomit = 1 } })
check("an unknown effect is refused", started(badFx) and started(badFx).ok == false)
local badAmt = sendSkin({ colors = { Body = { r = 0.5, g = 0.5, b = 0.5 } }, effects = { Mud = 2 } })
check("an effect past 1 is refused", started(badAmt) and started(badAmt).ok == false and mudSet == 0.8)
local dead = H.makePawn({ growth = 0.5, health = 0 })
local deadCtrl = H.makeCtrl(STEAM, dead)
useCtrl(deadCtrl)
local nd = sendSkin({ colors = { Body = { r = 0.1, g = 0.1, b = 0.1 } } })
check("a dead dino is not painted", started(nd) and started(nd).ok == false and lastMsg(deadCtrl):find("dino còn sống", 1, true) ~= nil)

say("\n-- kept skin: painted on a new dino of that species, not over a garage slot --")
local keepLoop
for _, l in ipairs(H.gameLoops) do if l.ms == 3000 then keepLoop = l end end
check("a kept-skins loop (3 s, game thread)", keepLoop ~= nil)
local KEEPER = "76561198000000077"
local kf = assert(io.open("Mods/DinoGarage/Saved/skins.json", "w"))
kf:write(json.encode({ players = { [KEEPER] = { BP_Dilo_C = { colors = { Body = { r = 0.9, g = 0.2, b = 0.1 } }, pattern = 2 } } } }))
kf:close()
local newDino = H.makePawn({ growth = 0.3 })
local keepCtrl = H.makeCtrl(KEEPER, newDino)
useCtrl(keepCtrl)
keepLoop.fn()                                   -- first seen
check("not at once: the game paints a new dino first", newDino.__skin.BodyColor.R == 0.5)
clock = clock + 6
keepLoop.fn()
check("5 s later: the kept colours are on it", newDino.__skin.BodyColor.R == 0.9 and newDino.__skin.PatternIndex == 2,
      json.encode(newDino.__skin.BodyColor))
check("the player is told", lastMsg(keepCtrl):find("màu bạn giữ", 1, true) ~= nil, lastMsg(keepCtrl))
newDino.__skin.BodyColor = { R = 0.1, G = 0.1, B = 0.1, A = 1 }
clock = clock + 6
keepLoop.fn()
check("only once per dino", newDino.__skin.BodyColor.R == 0.1)
local fromGarage = H.makePawn({ growth = 0.3 })
local gCtrl = H.makeCtrl(KEEPER, fromGarage)
useCtrl(gCtrl)
require("garage.skin").restoredAt[KEEPER] = clock
keepLoop.fn(); clock = clock + 6; keepLoop.fn()
check("a dino just taken out of the garage keeps its slot's colours", fromGarage.__skin.BodyColor.R == 0.5)
os.remove("Mods/DinoGarage/Saved/skins.json")

say("\n-- admin light test: a replicated light attached to the player's dino, then off --")
local events = {}
local lightObj = { PointLightComponent = { SetIntensity = function(_, v) events[#events + 1] = "intensity " .. v end,
  SetLightColor = function() end, SetAttenuationRadius = function() end, SetCastShadows = function() end } }
lightObj.GetAddress = function() return 4242 end
lightObj.IsValid = function() return true end
lightObj.SetReplicates = function(_, v) events[#events + 1] = "replicates " .. tostring(v) end
lightObj.K2_AttachToActor = function(_, parent) events[#events + 1] = "attach " .. tostring(parent ~= nil) end
lightObj.K2_DestroyActor = function() events[#events + 1] = "destroy" end
lightObj.SetActorHiddenInGame = function() end
lightObj.K2_DetachFromActor = function() events[#events + 1] = "detach" end
local statics = {
  IsValid = function() return true end,
  BeginDeferredActorSpawnFromClass = function() events[#events + 1] = "begin"; return lightObj end,
  FinishSpawningActor = function() events[#events + 1] = "finish (bReplicates " .. tostring(lightObj.bReplicates) .. ")" end,
}
local savedSFO = _G.StaticFindObject
_G.StaticFindObject = function(path) if path:find("GameplayStatics", 1, true) then return statics end; return { IsValid = function() return true end } end
local lit = H.makePawn({ growth = 0.5 })
rawset(lit, "GetWorld", function() return { IsValid = function() return true end } end)
local litCtrl = H.makeCtrl(STEAM, lit)
local savedFAO = _G.FindAllOf
_G.FindAllOf = function(c) H.touch("FindAllOf"); if c == "PointLight" then return { lightObj } end; return { litCtrl } end
local function sendLight(on)
  nextId = nextId + 1
  local c = { id = nextId, type = "light", steamId = STEAM, createdAt = clock, expiresAt = clock + 600, on = on }
  local fl = assert(io.open("Mods/DinoGarage/Saved/inbox.json", "w"))
  fl:write(json.encode({ commands = { c } })); fl:close()
  poll.fn()
  return nextId
end
local lon = sendLight(true)
local seq = table.concat(events, ", ")
check("on: deferred spawn, replicated before it finishes, attached, lit", started(lon) and started(lon).ok == true
      and seq:find("begin, replicates true, finish (bReplicates true), attach true, intensity 8000", 1, true) ~= nil, seq)
check("the crash flag is down", io.open("Mods/DinoGarage/Saved/light-test.trying", "r") == nil)
events = {}
local loff = sendLight(false)
seq = table.concat(events, ", ")
check("off: dimmed, detached, destroyed", started(loff) and started(loff).ok == true and seq == "intensity 0, detach, destroy", seq)
_G.StaticFindObject, _G.FindAllOf = savedSFO, savedFAO

say("\n-- a mutation item's slot is a number (1–4), not a garage slot name --")
do
  -- 2026-10-02: the garage's name check refused every mutation item ("bad_arguments").
  local mp = H.makePawn({ growth = 0.8, mutation = "MUT_Life" })
  local mc = H.makeCtrl(STEAM, mp)
  useCtrl(mc)
  local function sendMut(slot)
    nextId = nextId + 1
    local c = { id = nextId, type = "mutation", mode = "place", steamId = STEAM, createdAt = clock, expiresAt = clock + 600,
                mutation = "Hydrodynamic", slot = slot, unlock = false }
    local fm = assert(io.open("Mods/DinoGarage/Saved/inbox.json", "w"))
    fm:write(json.encode({ commands = { c } })); fm:close()
    poll.fn()
    return nextId
  end
  local m1 = sendMut(3)
  check("slot 3 runs, put in slot 3", started(m1) and started(m1).ok == true
        and mp.ReplicatedMutationsData.MutationSlot3:ToString() == "Hydrodynamic", started(m1) and json.encode(started(m1)))
  check("the result's slot is a string (the bridge reads it so)", started(m1) and started(m1).slot == "3")
  local m2 = sendMut(7)
  check("slot 7 refused before anything runs", started(m2) and started(m2).error == "bad_arguments")
end

say("\n-- the bag's growth bag and food box: on the dino played now, refused (item kept) when they do not apply --")
do
  local function sendUse(fields)
    nextId = nextId + 1
    local c = { id = nextId, type = "mutation", steamId = STEAM, createdAt = clock, expiresAt = clock + 600 }
    for k, v in pairs(fields) do c[k] = v end
    local fm = assert(io.open("Mods/DinoGarage/Saved/inbox.json", "w"))
    fm:write(json.encode({ commands = { c } })); fm:close()
    poll.fn()
    return nextId
  end
  local gp = H.makePawn({ growth = 0.55 })
  -- The harness's SetGrowth does not change what GetGrowth reads: as the engine does.
  rawset(gp, "SetGrowth", function(_, g) H.record("SetGrowth", g); gp.__props.Growth = g end)
  local gc = H.makeCtrl(STEAM, gp)
  useCtrl(gc)
  local g1 = sendUse({ mode = "growth", amount = 0.1, below = 0.6 })
  check("55 % + 10 %: 65 % (owner's call: the full 10 %)", started(g1) and started(g1).ok == true and math.abs(gp.__props.Growth - 0.65) < 1e-6,
        tostring(gp.__props.Growth))
  local g2 = sendUse({ mode = "growth", amount = 0.1, below = 0.6 })
  check("65 %: refused, told why, growth kept", started(g2) and started(g2).ok == false and math.abs(gp.__props.Growth - 0.65) < 1e-6
        and lastMsg(gc):find("dưới 60%", 1, true) ~= nil, lastMsg(gc))
  local fp = H.makePawn({ growth = 0.8 })
  rawset(fp, "SetHunger", function(_, x) fp.__props.Hunger = x end)
  fp.__props.MaxHunger, fp.__props.Hunger = 100, 30
  local fc = H.makeCtrl(STEAM, fp)
  useCtrl(fc)
  local f1 = sendUse({ mode = "food", amount = 0.5 })
  check("food 30 % + 50 %: 80 %", started(f1) and started(f1).ok == true and math.abs(fp.__props.Hunger - 80) < 1e-6, tostring(fp.__props.Hunger))
  fp.__props.Hunger = 100
  local f2 = sendUse({ mode = "food", amount = 0.2 })
  check("a full dino: refused (the item stays)", started(f2) and started(f2).ok == false and lastMsg(fc):find("no", 1, true) ~= nil, lastMsg(fc))
  local cured = false
  rawset(fp, "ResetVomitSickState", function() cured = true end)
  local c1 = sendUse({ mode = "cure" })
  check("salt lick: the sickness after vomiting reset, the player told", started(c1) and started(c1).ok == true and cured
        and lastMsg(fc):find("đá muối", 1, true) ~= nil, lastMsg(fc))
end

say("\n-- the admin's minimums: health and growth needed to store --")
do
  writeSettings('{"storeCountdown":30,"cooldown":0,"maxSlots":20,"minHealthPct":80,"minGrowthPct":50}')
  clock = clock + 100
  local MIN = STEAM
  local hurt = H.makePawn({ growth = 0.9, health = 50 })
  local hurtCtrl = H.makeCtrl(MIN, hurt)
  useCtrl(hurtCtrl)
  local r1 = send("store")
  check("50 % health, 80 % needed: refused, told why", started(r1) and started(r1).ok == false
        and lastMsg(hurtCtrl):find("80%", 1, true) ~= nil and lastMsg(hurtCtrl):find("50%", 1, true) ~= nil, lastMsg(hurtCtrl))
  local young = H.makePawn({ growth = 0.3, health = 100 })
  local youngCtrl = H.makeCtrl(MIN, young)
  useCtrl(youngCtrl)
  local r2 = send("store")
  check("30 % growth, 50 % needed: refused, told why", started(r2) and started(r2).ok == false
        and lastMsg(youngCtrl):find("50%", 1, true) ~= nil and lastMsg(youngCtrl):find("30%", 1, true) ~= nil, lastMsg(youngCtrl))
  local fine = H.makePawn({ growth = 0.9, health = 90 })
  useCtrl(H.makeCtrl(MIN, fine))
  local r3 = send("store")
  check("90 % health, 90 % growth: the countdown starts", started(r3) and started(r3).ok == true,
        started(r3) and json.encode(started(r3)))
  writeSettings('{"storeCountdown":30,"cooldown":60,"maxSlots":5}')
end

say("\n-- unlock heal: a mutation in its slot but not unlocked gets its unlock back, once --")
local healLoop
for _, l in ipairs(H.gameLoops) do if l.ms == 15000 then healLoop = l end end
check("an unlock-heal loop (15 s, game thread)", healLoop ~= nil)
local HEALED = "76561198000000088"
-- Taken out of the garage before the list was kept: Reniculate Kidneys in slot 1, not unlocked.
local croc = H.makePawn({ mutation = "Reniculate Kidneys", unlocks = { "Traumatic Thrombosis", "Multichambered Lungs" } })
useCtrl(H.makeCtrl(HEALED, croc))
H.calls = {}
healLoop.fn()
check("unlocked again, nothing else touched", table.concat(croc.MutationsRequirementsData.UnlockRequiredMutations.__names, ",")
      == "Traumatic Thrombosis,Multichambered Lungs,Reniculate Kidneys,MUT_Parent"
      and H.countCalls("SetMutationRequirementsData") == 1 and H.countCalls("ClientUpdateMutations") == 1
      and H.countCalls("SetReplicatedMutationsData") == 0,
      table.concat(croc.MutationsRequirementsData.UnlockRequiredMutations.__names, ","))
healLoop.fn(); healLoop.fn()
check("then left alone: no write again", H.countCalls("SetMutationRequirementsData") == 1)
local fine = H.makePawn({ mutation = "Hydrodynamic", unlocks = { "Traumatic Thrombosis", "Hydrodynamic", "MUT_Parent" } })
useCtrl(H.makeCtrl("76561198000000089", fine))
H.calls = {}
healLoop.fn()
check("a dino whose slots are all unlocked: not written", H.countCalls("SetMutationRequirementsData") == 0)

say("\n-- tele con non: B moves next to A, both small, no fight for 60 s, 5 s still, then the cooldown --")
do
  local teleLoop
  for _, l in ipairs(H.gameLoops) do if l.ms == 1500 then teleLoop = l end end
  check("a tele guard loop (1.5 s, game thread)", teleLoop ~= nil)
  local MOM, BABY = "76561198000000071", "76561198000000072"
  local mom = H.makePawn({ growth = 0.35, loc = { X = 50000, Y = -20000, Z = 800 } })
  local baby = H.makePawn({ growth = 0.2, loc = { X = 1000, Y = 1000, Z = 100 } })
  local momCtrl, babyCtrl = H.makeCtrl(MOM, mom), H.makeCtrl(BABY, baby)
  _G.FindAllOf = function() H.touch("FindAllOf"); return { momCtrl, babyCtrl } end
  local function sendTele(over)
    nextId = nextId + 1
    local c = { id = nextId, type = "tele", steamId = BABY, target = MOM, maxGrowth = 0.4, targetMaxGrowth = 0.4,
                combatS = 60, countdownS = 5, cooldownS = 60, createdAt = clock, expiresAt = clock + 60 }
    for k, v in pairs(over or {}) do c[k] = v end
    local f = assert(io.open("Mods/DinoGarage/Saved/inbox.json", "w"))
    f:write(json.encode({ commands = { c } }))
    f:close()
    poll.fn()
    return nextId
  end
  local function teleEnd(id) return byId("tele_result", id) end
  clock = clock + 1000
  teleLoop.fn()   -- first health samples

  baby.__props.Growth = 0.5
  local t1 = sendTele()
  check("B at 50 %, 40 % allowed: refused, told why", started(t1) and started(t1).ok == false
        and (started(t1).messages[1] or ""):find("40%", 1, true) ~= nil and (started(t1).messages[1] or ""):find("50%", 1, true) ~= nil,
        started(t1) and json.encode(started(t1)))
  baby.__props.Growth = 0.4
  mom.__props.Growth = 0.6
  local t2 = sendTele()
  check("A at 60 %: refused (the one moved to is too big)", started(t2) and started(t2).ok == false
        and (started(t2).messages[1] or ""):find("người đưa mã", 1, true) ~= nil, started(t2) and json.encode(started(t2)))
  mom.__props.Growth = 0.35

  -- A player bite on B: no tele for 60 s.
  H.fire(DAMAGE, H.param(H.makePawn({})), H.param(baby), H.param(25))
  local t3 = sendTele()
  check("bitten by a player just now: refused, seconds left told", started(t3) and started(t3).ok == false
        and (started(t3).messages[1] or ""):find("giao tranh", 1, true) ~= nil, started(t3) and json.encode(started(t3)))
  clock = clock + 61
  -- An AI bite fires no hook: the health sample sees it.
  baby.__props.Health = 60
  teleLoop.fn()
  local t4 = sendTele()
  check("lost health (an AI bite) just now: refused too", started(t4) and started(t4).ok == false
        and (started(t4).messages[1] or ""):find("giao tranh", 1, true) ~= nil, started(t4) and json.encode(started(t4)))
  clock = clock + 61
  teleLoop.fn()

  -- The move.
  H.calls = {}
  local t5 = sendTele()
  check("60 s after the fight: the countdown starts, the rules told", started(t5) and started(t5).ok == true
        and (started(t5).messages[1] or ""):find("5 m", 1, true) ~= nil, started(t5) and json.encode(started(t5)))
  teleLoop.fn(); teleLoop.fn()
  check("standing still: nothing yet", teleEnd(t5) == nil and H.countCalls("K2_SetActorLocation") == 0)
  H.advance(5100)
  local moved = nil
  for _, c in ipairs(H.calls) do if c.what == "K2_SetActorLocation" then moved = c.args[1] end end
  check("after 5 s: B put where A stands (a little above)", moved and moved.X == 50000 and moved.Y == -20000 and moved.Z == 830,
        moved and json.encode(moved))
  check("tele_result ok for the web, A as the target", teleEnd(t5) and teleEnd(t5).ok == true and teleEnd(t5).target == MOM)
  check("both told", lastMsg(babyCtrl):find("Đã dịch chuyển", 1, true) ~= nil and lastMsg(momCtrl):find("tới chỗ bạn", 1, true) ~= nil,
        lastMsg(babyCtrl) .. " / " .. lastMsg(momCtrl))
  check("growth and vitals untouched (only the location)", H.countCalls("SetGrowth") == 0 and H.countCalls("SetHealth") == 0
        and H.countCalls("SetHunger") == 0)
  local t6 = sendTele()
  check("again at once: the cooldown", started(t6) and started(t6).ok == false
        and (started(t6).messages[1] or ""):find("hồi", 1, true) ~= nil, started(t6) and json.encode(started(t6)))
  clock = clock + 61

  -- Walking off during the countdown: no move.
  H.calls = {}
  local t7 = sendTele()
  baby.__props.Loc = { X = baby.__props.Loc.X + 800, Y = baby.__props.Loc.Y, Z = baby.__props.Loc.Z }
  teleLoop.fn()
  H.advance(5100)
  check("moved 8 m during the countdown: failed (moved), not moved", teleEnd(t7) and teleEnd(t7).ok == false
        and teleEnd(t7).reason == "moved" and H.countCalls("K2_SetActorLocation") == 0, teleEnd(t7) and json.encode(teleEnd(t7)))

  -- Hit by a player during the countdown.
  local t8 = sendTele()
  H.fire(DAMAGE, H.param(baby), H.param(H.makePawn({})), H.param(25))
  check("hits a player during the countdown: failed at once (damage_dealt)", teleEnd(t8) and teleEnd(t8).reason == "damage_dealt")
  clock = clock + 61
  teleLoop.fn()

  -- A in the air when the countdown ends.
  local t9 = sendTele()
  mom.__props.Falling = true
  H.advance(5100)
  check("A falling / flying at the end: failed (target_air), not moved", teleEnd(t9) and teleEnd(t9).reason == "target_air"
        and H.countCalls("K2_SetActorLocation") == 0, teleEnd(t9) and json.encode(teleEnd(t9)))
  mom.__props.Falling = false

  -- A left the game.
  _G.FindAllOf = function() H.touch("FindAllOf"); return { babyCtrl } end
  local t10 = sendTele()
  check("A not in game: refused", started(t10) and started(t10).ok == false)
  _G.FindAllOf = function() H.touch("FindAllOf"); return { momCtrl, babyCtrl } end

  -- In prison.
  local pf = assert(io.open("Mods/shared/isle-prison.json", "w"))
  pf:write(json.encode({ inmates = { BABY } })); pf:close()
  clock = clock + 10
  local t11 = sendTele()
  check("B in prison: refused", started(t11) and started(t11).ok == false
        and (started(t11).messages[1] or ""):find("tù", 1, true) ~= nil)
  os.remove("Mods/shared/isle-prison.json")
  clock = clock + 10
  -- Bad arguments from a broken inbox: refused, nothing moved.
  local t12 = sendTele({ target = BABY })
  check("a tele to yourself: refused", started(t12) and started(t12).ok == false)
end

say("")
say("-- threads: nothing the mod ran from an async callback touched the engine --")
check("no engine access off the game thread", H.offThreadAccess == 0, table.concat(H.offThreadWhat, ", "))

say(string.format("=== DinoGarage: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
