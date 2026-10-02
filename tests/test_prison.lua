-- Prison: an inmate's dino is moved to the prison (once settled), kept as it
-- was (growth, stomach, thirst, prime tasks; health inside), serves time only
-- online and inside, escapes and comes back (one event each), goes back to
-- where it was arrested when the time is served or it is released; a new
-- dino goes in again; outsiders are stung, admins are not; state survives a
-- reload; all on the game thread.
local function say(s) io.write(tostring(s)) io.write(string.char(10)) end
local H = require("harness")
local json = require("shared.isle.json")
local pass, fail = 0, 0
local function check(name, ok, detail)
  if ok then pass = pass + 1; say("  ok   " .. name)
  else fail = fail + 1; say("  FAIL " .. name .. (detail and ("  -> " .. detail) or "")) end
end

os.execute('mkdir -p "' .. RUN .. '/Mods/Prison/Saved"')
local CONFIG = "Mods/Prison/Saved/prison.json"
local STATE = "Mods/Prison/Saved/state.json"
local EVENTS = "Mods/StatsLogger/Saved/events.ndjson"
os.remove(STATE); os.remove(EVENTS)
local function config(t) local f = assert(io.open(CONFIG, "w")); f:write(json.encode(t)); f:close() end
local clock = 5000
os.time = function() return clock end

local INMATE, OTHER, ADMIN = "76561190000000011", "76561190000000012", "76561190000000013"
-- The prison: a square 0..10000 (100 m); one drop spot inside it, at height 500.
local ZONE = { name = "Nhà tù", x = 5000, y = 5000, radius = 7072, poly = { { 0, 0 }, { 10000, 0 }, { 10000, 10000 }, { 0, 10000 } } }
local BASE = { enabled = true, zone = ZONE, drops = { { 4000, 4000, 500 } }, sting = { grace = 10, every = 3, pct = 10 },
  exempt = { ADMIN }, sentences = { [INMATE] = { id = "s1", total = 60, release = false } } }
config(BASE)

--- A pawn whose vitals setters change what its getters read (the harness only models SetHealth).
local function dino(opts)
  local p = H.makePawn(opts)
  for _, v in ipairs({ "Hunger", "Thirst" }) do
    rawset(p, "Set" .. v, function(_, x) H.record("Set" .. v, x); p.__props[v] = x end)
  end
  rawset(p, "SetGrowth", function(_, x) H.record("SetGrowth", x); p.__props.Growth = x; p.__props.Health = p.__props.MaxHealth end)
  return p
end

local con = dino({ class = "BP_Carnotaurus_C", growth = 0.6, loc = { X = 90000, Y = 90000, Z = 100 } })
local cc = H.makeCtrl(INMATE, con)
local other = dino({ class = "BP_Troodon_C", growth = 0.5, loc = { X = 50000, Y = 0, Z = 0 } })
local oc = H.makeCtrl(OTHER, other)
local admin = dino({ class = "BP_Tyrannosaurus_C", growth = 1, loc = { X = 5000, Y = 5000, Z = 0 } })
local ac = H.makeCtrl(ADMIN, admin)
local online = { cc, oc, ac }
_G.FindAllOf = function(c) if c == "PlayerController" then return online end; return {} end

dofile(RUN .. "/Mods/Prison/Scripts/main.lua")
local tick
for _, l in ipairs(H.gameLoops) do if l.ms == 1000 then tick = l end end
check("one game-thread loop", tick ~= nil)
local function step(s) for _ = 1, s do clock = clock + 1; tick.fn() end end
local function events(kind)
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
local function state() local f = io.open(STATE, "r"); if not f then return nil end; local d = json.decode(f:read("*a")); f:close(); return d end
local L = function(p) return p.__props.Loc end

say("\n-- 1. moved in once the dino has settled; where it stood is kept --")
step(1)
check("not at once: a fresh dino settles first", L(con).X == 90000)
step(3)
check("moved to the drop spot, a little above it", L(con).X == 4000 and L(con).Y == 4000 and L(con).Z == 600,
  json.encode(L(con)))
check("one 'jailed' event, the first", #events("prison_jailed") == 1 and events("prison_jailed")[1].again == false
  and events("prison_jailed")[1].id == "s1" and events("prison_jailed")[1].species == "Carnotaurus")
step(5)
local st = state()
check("state saved: arrest spot, time running", st and st.sentences.s1 and st.sentences.s1.arrest.x == 90000
  and st.sentences.s1.served >= 1 and st.sentences.s1.inside == true, st and json.encode(st.sentences.s1))

say("\n-- 2. kept as it was --")
local served0 = state().sentences.s1.served
con.__props.Health = 40
step(1)
check("inside: health cannot go down", con.__props.Health == 100, tostring(con.__props.Health))
con.__props.Hunger, con.__props.Thirst = 10, 20
step(1)
check("stomach and thirst put back", con.__props.Hunger == 70 and con.__props.Thirst == 65,
  con.__props.Hunger .. " / " .. con.__props.Thirst)
con.__props.Growth = 0.61
H.calls = {}
step(1)
check("growth put back to 60%, then the vitals SetGrowth refilled", con.__props.Growth == 0.6 and con.__props.Hunger == 70
  and H.countCalls("SetGrowth") == 1)
con.__prime.bPrimeCondition1 = true          -- not met when moved in
step(5)
check("a prime task gained in prison is taken back", con.__prime.bPrimeCondition1 == false)
check("…the ones it had stay", con.__prime.bPrimeCondition3 == true)

say("\n-- 2b. no sleeping: woken up, told why --")
do
  local wakes = 0
  rawset(con, "WakeUp", function() wakes = wakes + 1; con.__props.bIsSleeping = false end)
  con.__props.bIsSleeping = true
  step(1)
  check("asleep in prison: WakeUp called, awake again", wakes == 1 and con.__props.bIsSleeping == false)
  local told = cc._messages
  check("told: no sleeping in prison", told[#told] ~= nil and told[#told]:find("không được ngủ", 1, true) ~= nil, tostring(told[#told]))
  -- A WakeUp that does nothing: the flag is cleared directly after a few seconds.
  rawset(con, "WakeUp", function() wakes = wakes + 1 end)
  con.__props.bIsSleeping = true
  step(5)
  check("still asleep after WakeUp: the flag is cleared", rawget(con, "bIsSleeping") == false)
  rawset(con, "bIsSleeping", nil); con.__props.bIsSleeping = false; rawset(con, "WakeUp", nil)
  step(4)                                     -- 10 s in all: the 5 s reload / save rhythm of the sections below is kept
  check("awake: left alone", con.__props.bIsSleeping == false and rawget(con, "bIsSleeping") == nil)
end

say("\n-- 3. escape: one event, no time served, health not held --")
step(10)
con.__props.Loc = { X = 30000, Y = 30000, Z = 0 }
step(6)                                       -- out, and saved since (the file is written every 5 s)
local servedOut = state().sentences.s1.served
check("one 'escape' event with where it is", #events("prison_escape") == 1 and events("prison_escape")[1].x == 30000
  and events("prison_escape")[1].escapes == 1)
con.__props.Health = 30
step(5)
check("outside: health not held", con.__props.Health == 30, tostring(con.__props.Health))
check("outside: no time served", state().sentences.s1.served == servedOut, state().sentences.s1.served .. " vs " .. tostring(servedOut))
check("outside: still kept fed as it was", con.__props.Hunger == 70)
check("still one escape event", #events("prison_escape") == 1)
con.__props.Loc = { X = 5000, Y = 5000, Z = 0 }
step(1)
check("back in: one 'returned' event", #events("prison_returned") == 1)
step(5)
check("…time runs again", state().sentences.s1.served > servedOut)

say("\n-- 4. offline: the clock stops --")
local before = state().sentences.s1.served
online = { oc, ac }
step(20)
online = { cc, oc, ac }
step(6)
-- 6 s online counted, plus up to 5 s not yet saved when `before` was read; 20 s offline would be far more.
check("20 s offline cost nothing", state().sentences.s1.served <= before + 12, state().sentences.s1.served .. " / " .. before)

say("\n-- 5. served: back to where it was arrested --")
step(60)
check("moved back to the arrest spot", L(con).X == 90000 and L(con).Y == 90000, json.encode(L(con)))
check("a 'released' event, not early", #events("prison_released") == 1 and events("prison_released")[1].early == false)
check("state: done", state().sentences.s1.done == true)
con.__props.Health = 20
step(3)
check("then left alone (health no longer held)", con.__props.Health == 20)

say("\n-- 6. a second sentence: a new dino goes in, early release --")
local two = { enabled = true, zone = ZONE, drops = BASE.drops, sting = BASE.sting, exempt = { ADMIN },
  sentences = { [INMATE] = { id = "s2", total = 3600, release = false } } }
config(two)
step(6)
check("moved in again (new sentence)", L(con).X == 4000, json.encode(L(con)))
con.__props.Health = 0                       -- killed in prison (one shot)
step(2)
local con2 = dino({ class = "BP_Dryosaurus_C", growth = 0.3, loc = { X = 70000, Y = 70000, Z = 0 } })
cc = H.makeCtrl(INMATE, con2)
online = { cc, oc, ac }
step(5)
check("the next dino is moved in too", L(con2).X == 4000, json.encode(L(con2)))
check("jailed again: 'again'", events("prison_jailed")[#events("prison_jailed")].again == true)
two.sentences[INMATE].release = true
config(two)
step(6)
check("released early: back where its first dino was arrested", L(con2).X == 70000 or L(con2).X == 90000, json.encode(L(con2)))
check("'released' early", events("prison_released")[#events("prison_released")].early == true)

say("\n-- 7. outsiders --")
other.__props.Loc = { X = 6000, Y = 6000, Z = 0 }
step(1)
check("an outsider in the prison is warned", (oc._messages[#oc._messages] or ""):find("nhà tù", 1, true) ~= nil)
step(9)
check("no sting during the grace", other.__props.Health == 100)
step(2)
check("then stung", other.__props.Health == 90, tostring(other.__props.Health))
check("an admin in the prison is left alone", admin.__props.Health == 100 and #ac._messages == 0)

say("\n-- 9. caught (\"teleport\"): an escaper brought to 20% does not die — back in the prison --")
local function sentence(id, mode)
  config({ enabled = true, zone = ZONE, drops = BASE.drops, sting = BASE.sting, exempt = { ADMIN },
    caught = { mode = mode, pct = 20 }, sentences = { [INMATE] = { id = id, total = 3600, release = false } } })
end
local function newDino(class, growth)
  local p = dino({ class = class, growth = growth, loc = { X = 90000, Y = 90000, Z = 100 } })
  cc = H.makeCtrl(INMATE, p)
  online = { cc, oc, ac }
  return p
end
sentence("s3", "teleport")
local p3 = newDino("BlueprintGeneratedClass /Game/BP_Carno.BP_Carno_C", 0.7)
step(5)
check("in the prison", L(p3).X == 4000)
p3.__props.Loc = { X = 30000, Y = 30000, Z = 0 }
step(7)
check("escaped", #events("prison_escape") >= 2)
p3.__props.Health = 15
step(1)
check("at 15% (of 100): put back at the drop spot", L(p3).X == 4000, json.encode(L(p3)))
check("…with the health it escaped with, not dead", p3.__props.Health == 100, tostring(p3.__props.Health))
check("a 'caught' event (the bridge credits the hunter)", #events("prison_caught") == 1 and events("prison_caught")[1].id == "s3")
step(6)                                       -- the state file is written every 5 s
check("back inside: no longer escaped", state().sentences.s3.escaped == false)

say("\n-- 10. died on the run (\"respawn\"): the next dino of that species is made into it, in the prison --")
sentence("s4", "respawn")
local p4 = newDino("BlueprintGeneratedClass /Game/BP_Carno.BP_Carno_C", 0.7)
step(5)
check("in the prison", L(p4).X == 4000)
p4.__props.Loc = { X = 30000, Y = 30000, Z = 0 }
step(7)
p4.__props.Health = 15
step(1)
check("respawn mode: not caught at 15%", L(p4).X == 30000)
p4.__props.Health = 0
step(2)
check("a 'died' event naming the species to spawn", #events("prison_died") == 1 and events("prison_died")[1].species == "BP_Carno_C",
  json.encode(events("prison_died")))
H.calls = {}
local p5 = newDino("BlueprintGeneratedClass /Game/BP_Carno.BP_Carno_C", 0.05)
step(5)
check("same species: moved to the prison", L(p5).X == 4000, json.encode(L(p5)))
local grew = false
for _, cl in ipairs(H.calls) do if cl.what == "SetGrowth" and math.abs((cl.args[1] or 0) - 0.7) < 1e-6 then grew = true end end
check("…and made into the dino it had (growth 70% back, the garage's restore)", grew)
H.advance(700)
check("a 'recreated' event once the restore is done", #events("prison_recreated") == 1 and events("prison_recreated")[1].ok == true)

say("\n-- 11. died on the run, then another species: that one goes in as it is --")
sentence("s5", "respawn")
local p6 = newDino("BlueprintGeneratedClass /Game/BP_Carno.BP_Carno_C", 0.6)
step(5)
p6.__props.Loc = { X = 30000, Y = 30000, Z = 0 }
step(7)
p6.__props.Health = 0
step(2)
H.calls = {}
local p7 = newDino("BlueprintGeneratedClass /Game/BP_Troodon.BP_Troodon_C", 0.2)
step(5)
check("another species: moved in", L(p7).X == 4000)
check("…not made into the Carnotaurus", H.countCalls("SetGrowth") == 0 and #events("prison_recreated") == 1)

say("\n-- 8. off --")
config({ enabled = false })
other.__props.Health = 100
step(20)
check("off: nothing happens", other.__props.Health == 100)

say("")
say("-- threads: nothing the mod ran from an async callback touched the engine --")
check("no engine access off the game thread", H.offThreadAccess == 0, table.concat(H.offThreadWhat or {}, ", "))

say(string.format("=== Prison: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
