-- Functional test: StatsLogger's hooks, its poll-based inference (sessions,
-- spawns, deaths, growth) and the split into two streams.

local function say(s) io.write(tostring(s)) io.write(string.char(10)) end

local H = require("harness")

local pass, fail = 0, 0
local function check(name, ok, detail)
  if ok then pass = pass + 1; say("  ok   " .. name)
  else fail = fail + 1; say("  FAIL " .. name .. (detail and ("  -> " .. detail) or "")) end
end

local A, B = "76561198000000001", "76561198000000002"
local DAMAGE_HOOK = "/Script/TheIsle.TICharacterBase:ApplyDamage"
local CHAT_HOOK   = "/Script/TheIsle.TIPlayerController:GetChatMessage"

local SAVED     = RUN .. "/ue4ss/Mods/StatsLogger/Saved/"
local EVENTS    = SAVED .. "events.ndjson"
local SNAPSHOTS = SAVED .. "snapshots.ndjson"
os.remove(EVENTS)
os.remove(SNAPSHOTS)

-- Two players, each pawn pointing back at its controller (that is how the
-- damage hook resolves a SteamID from a pawn).
local pawnA, pawnB = H.makePawn({}), H.makePawn({ growth = 0.2 })
local ctrlA, ctrlB = H.makeCtrl(A, pawnA, "Alpha"), H.makeCtrl(B, pawnB, "Bravo")
H.attachController(pawnA, ctrlA)
H.attachController(pawnB, ctrlB)

local online = { ctrlA, ctrlB }
_G.FindAllOf = function() H.touch("FindAllOf"); return online end

dofile(RUN .. "/ue4ss/Mods/StatsLogger/Scripts/main.lua")

local json = require("shared.isle.json")
local function read(path)
  local f = io.open(path, "r")
  if not f then return {} end
  local out = {}
  for line in f:lines() do
    if line ~= "" then
      local ok, e = pcall(json.decode, line)
      if ok then out[#out + 1] = e end
    end
  end
  f:close()
  return out
end

local function ofType(t, path)
  local out = {}
  for _, e in ipairs(read(path or EVENTS)) do if e.type == t then out[#out + 1] = e end end
  return out
end
local function count(t, path) return #ofType(t, path) end
local function last(t, path) local l = ofType(t, path); return l[#l] end

local loop

say("")
say("-- 1. the mod announces itself and registers one loop --")
check("mod_loaded emitted", count("mod_loaded") == 1)
check("a loop was registered", #H.loops == 1, tostring(#H.loops))
loop = H.loops[1]
check("async tick is 1s", loop.ms == 1000, tostring(loop.ms))

say("")
say("-- 1b. the async tick never reads the game; the read runs on the game thread --")
local offBefore = H.offThreadAccess
for _ = 1, 4 do loop.fn() end
check("four ticks: no snapshot read yet", count("snapshot", SNAPSHOTS) == 0)
loop.fn()                                   -- 5th tick queues the read
check("fifth tick queued, still nothing read", count("snapshot", SNAPSHOTS) == 0
      and count("session_start") == 0)
loop.fn(); loop.fn()                        -- slow game thread: no second read stacked
H.advance(0)                                -- the game thread runs the read (once)
check("nothing written from the game thread", count("snapshot", SNAPSHOTS) == 0)
loop.fn()                                   -- the next tick writes it
check("snapshots written by the async tick", count("snapshot", SNAPSHOTS) == 2,
      tostring(count("snapshot", SNAPSHOTS)))
check("not a single engine access off the game thread", H.offThreadAccess == offBefore,
      table.concat(H.offThreadWhat, ","))

-- One full cycle: enough ticks to queue a read, the game thread, one write.
-- Every step also asserts that no engine object was touched off-thread.
local function poll()
  local before = H.offThreadAccess
  for _ = 1, 5 do loop.fn() end
  H.advance(0)
  loop.fn()
  if H.offThreadAccess ~= before then
    check("poll stayed on the game thread", false, table.concat(H.offThreadWhat, ","))
  end
end

say("")
say("-- 2. that first poll: sessions open, lives start, snapshots go to their own file --")
check("two session_start", count("session_start") == 2, tostring(count("session_start")))
check("session carries the display name", last("session_start").name == "Bravo",
      tostring(last("session_start").name))
check("two spawn", count("spawn") == 2, tostring(count("spawn")))
check("snapshots written to snapshots.ndjson", count("snapshot", SNAPSHOTS) == 2,
      tostring(count("snapshot", SNAPSHOTS)))
check("no snapshot in events.ndjson", count("snapshot") == 0, tostring(count("snapshot")))
local snap = last("snapshot", SNAPSHOTS)
check("snapshot has position", snap and snap.loc and snap.loc.x == 1 and snap.loc.z == 3,
      snap and json.encode(snap.loc or {}) or "nil")
check("snapshot has yaw and name", snap and snap.yaw == 90 and snap.name == "Bravo")
check("snapshot has oxygen and blood", snap and snap.oxygen == 100 and snap.blood == 100)

say("")
say("-- 3. a second poll with nothing new emits no lifecycle events --")
poll()
check("still two session_start", count("session_start") == 2)
check("still two spawn", count("spawn") == 2)

say("")
say("-- 4. a player-on-player hit is queued, then written on the tick --")
H.fire(DAMAGE_HOOK, H.param(pawnA), H.param(pawnB), H.param(42))
check("hook itself wrote nothing", count("damage") == 0, tostring(count("damage")))
poll()
local dmg = last("damage")
check("damage event written by the tick", dmg ~= nil)
if dmg then
  check("attacker is A", dmg.attacker == A, tostring(dmg.attacker))
  check("victim is B", dmg.victim == B, tostring(dmg.victim))
  check("amount carried", dmg.amount == 42, tostring(dmg.amount))
  check("names and species carried",
        dmg.attackerName == "Alpha" and dmg.victimName == "Bravo"
        and dmg.victimSpecies ~= nil, json.encode(dmg))
  check("victim position carried", dmg.loc and dmg.loc.y == 2)
end

say("")
say("-- 5. a hit from an AI pawn is labelled, not dropped --")
local aiPawn = H.makePawn({})          -- no controller attached
H.fire(DAMAGE_HOOK, H.param(aiPawn), H.param(pawnB), H.param(7))
poll()
local ai = last("damage")
check("attacker recorded as ai", ai and ai.attacker == "ai", tostring(ai and ai.attacker))
check("victim still identified", ai and ai.victim == B, tostring(ai and ai.victim))
-- An unattributable hit must not erase the player hit that came before it,
-- or a real killer gets turned into an anonymous death. Proven in step 6.

say("")
say("-- 6. HP crossing to zero is a death, attributed to A with details --")
check("no death yet", count("death") == 0)
pawnB:SetHealth(0)
H.calls = {}
poll()
check("death emitted", count("death") == 1, tostring(count("death")))
local death = last("death")
if death then
  check("victim is B", death.steamId == B, tostring(death.steamId))
  check("attributed to the recent hit", death.attributed == true and death.killer == A,
        tostring(death.killer))
  check("killer name, species, growth carried",
        death.killerName == "Alpha" and death.killerSpecies ~= nil
        and death.killerGrowth == 0.9, json.encode(death))
  check("death position and life length carried",
        death.loc ~= nil and type(death.lifeSeconds) == "number")
end

say("")
say("-- 7. the death is reported once, not on every poll --")
poll()
poll()
check("still exactly one death", count("death") == 1, tostring(count("death")))

say("")
say("-- 8. respawning after a death is a new spawn --")
local spawnsBefore = count("spawn")
local pawnB2 = H.makePawn({ growth = 0.2 })
H.attachController(pawnB2, ctrlB)
ctrlB.__setPawn(pawnB2)
poll()
check("new spawn for B", count("spawn") == spawnsBefore + 1,
      tostring(count("spawn")) .. " vs " .. tostring(spawnsBefore + 1))

say("")
say("-- 9. natural growth crosses a milestone, once --")
pawnB2.__props.Growth = 0.24
poll()
check("no milestone below 0.25", count("growth") == 0)
pawnB2.__props.Growth = 0.26
poll()
poll()
local g = last("growth")
check("milestone 0.25 emitted once", count("growth") == 1 and g.milestone == 0.25,
      tostring(count("growth")))

say("")
say("-- 10. a growth jump is logged as set, not as milestones --")
pawnB2.__props.Growth = 0.9
poll()
check("growth_set emitted", count("growth_set") == 1, tostring(count("growth_set")))
local gs = last("growth_set")
check("from/to carried", gs and gs.from == 0.26 and gs.to == 0.9, gs and json.encode(gs))
check("no milestones for the jump", count("growth") == 1, tostring(count("growth")))

say("")
say("-- 10b. spawn carries the class path and mutations; a pick is logged --")
local sp = last("spawn")
check("spawn has full classPath", sp and sp.classPath == "BlueprintGeneratedClass /Game/BP_Dilo.BP_Dilo_C",
      sp and tostring(sp.classPath))
check("spawn has mutations", sp and sp.mutations and sp.mutations.Slot1 == "MUT_Life"
      and sp.mutations.ParentSlot1 == "MUT_Parent" and sp.mutations.Slot2 == nil,
      sp and json.encode(sp.mutations or {}))
-- The player picks a mutation in-game. That write is the test's, not the
-- mod's, so it must not count against step 14's "never mutates" check.
pawnB2.ReplicatedMutationsData.MutationSlot2 = FName("MUT_Hematophagy")
H.calls = {}
poll()
local mu = last("mutation")
check("mutation event for the new slot", mu and mu.slot == "Slot2" and mu.to == "MUT_Hematophagy"
      and mu.from == nil, mu and json.encode(mu))
poll()
check("logged once", count("mutation") == 1, tostring(count("mutation")))

say("")
say("-- 11. chat is logged with the sender --")
H.fire(CHAT_HOOK, H.param(ctrlA), H.param("hello there"))
H.fire(CHAT_HOOK, H.param(ctrlA), H.param("hello there"))   -- duplicate fire
H.advance(0)
poll()
check("one chat line despite the duplicate fire", count("chat") == 1, tostring(count("chat")))
local c = last("chat")
check("chat carries sender and text", c and c.steamId == A and c.name == "Alpha"
      and c.message == "hello there")

say("")
say("-- 12. a player leaving closes their session --")
online = { ctrlA }
poll()
local ended = last("session_end")
check("session_end for B", ended and ended.steamId == B, tostring(ended and ended.steamId))
check("session has a duration", ended and type(ended.duration) == "number")
poll()
check("closed once", count("session_end") == 1, tostring(count("session_end")))

say("")
say("-- 13. an unattributed death carries no killer --")
pawnA.__props.Health = 0
poll()
local d2 = last("death")
check("second death emitted", count("death") == 2, tostring(count("death")))
check("no killer attributed", d2 and d2.killer == nil and d2.attributed == false,
      tostring(d2 and d2.killer))

say("")
say("-- 14. the mod never mutates the world --")
check("no engine setters called by the loop", #H.calls == 0,
      table.concat(H.callNames(), ","))

say("")
say(string.format("=== StatsLogger: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
