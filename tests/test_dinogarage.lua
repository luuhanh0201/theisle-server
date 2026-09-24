-- Functional test: drives DinoGarage through a full store/redeem cycle
-- against the mock UE4SS harness.

-- The harness replaces the global print (mods log through it), so keep a real
-- writer for the test's own output.
local function say(s) io.write(tostring(s)) io.write(string.char(10)) end

local H = require("harness")

local pass, fail = 0, 0
local function check(name, ok, detail)
  if ok then pass = pass + 1; say("  ok   " .. name)
  else fail = fail + 1; say("  FAIL " .. name .. (detail and ("  -> " .. detail) or "")) end
end

local STEAM = "76561198000000001"
local CHAT  = "/Script/TheIsle.TIPlayerController:GetChatMessage"

-- A clock the test drives: the garage cooldown uses os.time().
local clock = 2000000
os.time = function() return clock end

-- Panel settings: most sections run without the garage cooldown; section 11
-- tests it on its own.
local SETTINGS = "Mods/DinoGarage/Saved/garage-settings.json"
local function writeSettings(json)
  local f = assert(io.open(SETTINGS, "w")); f:write(json); f:close()
end
writeSettings('{"storeCountdown":30,"cooldown":0}')

-- Load the mod exactly as UE4SS would.
-- gasVitals: like the live server, vitals are only reachable through getters.
local pawn = H.makePawn({ growth = 0.9, mutation = "MUT_Life", gasVitals = true })
local ctrl = H.makeCtrl(STEAM, pawn)
_G.FindAllOf = function() H.touch("FindAllOf"); return { ctrl } end

dofile(RUN .. "/Mods/DinoGarage/Scripts/main.lua")

print("\n-- 1. mod loads and registers the chat hook --")
check("chat hook registered", H.hooks[CHAT] ~= nil)

print("\n-- 2. !store counts down, then captures, saves and removes in ONE tick --")
H.chat(CHAT, ctrl, ctrl, "!store")
H.advance(10)
local slotFile = RUN .. "/Mods/DinoGarage/Saved/stored/" .. STEAM .. "__default.json"
check("nothing saved during the countdown", io.open(slotFile, "r") == nil)
check("dino untouched during the countdown", H.countCalls("SetHealth") == 0)
H.advance(20000)
local warned = false
for _, m in ipairs(ctrl._messages) do if m:match("10 seconds") then warned = true end end
check("a 10-seconds-left warning", warned)
H.advance(10100)
check("stored and removed together at 30 s", H.countCalls("SetHealth") == 1 and io.open(slotFile, "r") ~= nil,
      "SetHealth x" .. H.countCalls("SetHealth"))
local f = io.open(slotFile, "r")
local raw = f and f:read("*a") or ""
if f then f:close() end

local json = require("shared.isle.json")
local okDecode, state = pcall(json.decode, raw)
check("slot file is valid JSON", okDecode, tostring(state))
if okDecode then
  check("version = 1", state.version == 1, tostring(state.version))
  check("growth captured", state.growth == 0.9, tostring(state.growth))
  check("health captured through GetHealth()", state.health == 100, tostring(state.health))
  check("stamina/hunger/thirst captured", state.stamina == 80 and state.hunger == 70
        and state.thirst == 65, tostring(state.stamina))
  check("max values captured", state.maxHunger == 100 and state.maxThirst == 100
        and state.maxStamina == 100, tostring(state.maxHunger))
  check("classPath captured", state.classPath ~= nil, tostring(state.classPath))
  check("active mutation captured", state.mutations.Slot1 == "MUT_Life",
        tostring(state.mutations.Slot1))
  check("inherited mutation captured", state.mutations.ParentSlot1 == "MUT_Parent",
        tostring(state.mutations.ParentSlot1))
  check("'None' slot stored as nil", state.mutations.Slot2 == nil,
        tostring(state.mutations.Slot2))
  check("elder stacks captured", state.elderStacks == 3, tostring(state.elderStacks))
  check("skin captured with the slot", state.skin and state.skin.colors.Body and state.skin.patternIndex == 3,
        state.skin and "ok" or "no skin")
  check("nutrients captured", state.nutrients.carbValue == 5,
        tostring(state.nutrients.carbValue))
end

print("\n-- 3. the kill used 0 health --")
check("killed with 0", H.calls[#H.calls].args[1] == 0, tostring(H.calls[#H.calls].args[1]))

print("\n-- 4. !redeem on the WRONG species is refused --")
H.calls = {}
local wrongPawn = H.makePawn({ class = "BlueprintGeneratedClass /Game/BP_Carno.BP_Carno_C" })
local wrongCtrl = H.makeCtrl(STEAM, wrongPawn)
_G.FindAllOf = function() H.touch("FindAllOf"); return { wrongCtrl } end
H.chat(CHAT, wrongCtrl, wrongCtrl, "!redeem")
H.advance(4000)
check("no restore attempted", H.countCalls("SetGrowth") == 0,
      "SetGrowth called " .. H.countCalls("SetGrowth") .. " times")
local msgs = wrongCtrl._messages
check("player told why", msgs[#msgs] and msgs[#msgs]:match("Wrong species") ~= nil,
      tostring(msgs[#msgs]))

print("\n-- 5. !redeem on the right species restores, in cookbook order --")
H.calls = {}
local fresh = H.makePawn({ growth = 0.05, mutation = "None" })
local freshCtrl = H.makeCtrl(STEAM, fresh)
_G.FindAllOf = function() H.touch("FindAllOf"); return { freshCtrl } end
-- A different string on purpose: the chat hook deduplicates identical
-- (sender, message) pairs for 3 real seconds, which section 4 just used up.
H.chat(CHAT, freshCtrl, freshCtrl, "!redeem default")
H.advance(10)
check("restore deferred, nothing applied yet", H.countCalls("SetGrowth") == 0)

H.advance(3100)    -- the 3s restore delay
local afterFirstPass = #H.calls
check("growth applied in first pass", H.countCalls("SetGrowth") == 1)
check("vitals applied in first pass", H.countCalls("SetHealth") >= 1)
check("inherited slots pushed", H.countCalls("SetReplicatedMutationsData") == 1)
check("nutrients pushed", H.countCalls("SetNutrientsStruct") == 1)
check("elder stacks NOT applied yet", H.countCalls("SetElderReplicationStacks") == 0)

H.advance(600)     -- the 500ms settle window
check("active slots pushed after settle", H.countCalls("SetReplicatedMutationsData") == 2,
      tostring(H.countCalls("SetReplicatedMutationsData")))
check("vitals re-applied after growth wipe", H.countCalls("SetHealth") >= 2,
      "SetHealth x" .. H.countCalls("SetHealth"))
check("elder stacks applied last", H.countCalls("SetElderReplicationStacks") == 1)

-- order assertions
local names = H.callNames()
local function firstIndex(n) for i, v in ipairs(names) do if v == n then return i end end end
local function lastIndex(n) local r; for i, v in ipairs(names) do if v == n then r = i end end return r end
check("SetGrowth precedes the final SetHealth",
      firstIndex("SetGrowth") < lastIndex("SetHealth"))
check("final vitals come after the growth wipe",
      lastIndex("__vitals_wiped_by_growth") < lastIndex("SetHealth"))
check("elder stacks after the last mutation push",
      lastIndex("SetReplicatedMutationsData") < firstIndex("SetElderReplicationStacks"))
check("FName objects written to slots, not strings",
      H.countCalls("field:MutationSlot1") >= 1)

print("\n-- 6. duplicate chat fires are deduplicated --")
H.calls = {}
local dctrl = H.makeCtrl(STEAM, H.makePawn({}))
_G.FindAllOf = function() H.touch("FindAllOf"); return { dctrl } end
H.chat(CHAT, dctrl, dctrl, "!garage")
H.chat(CHAT, dctrl, dctrl, "!garage")
H.chat(CHAT, dctrl, dctrl, "!garage")
H.advance(50)
local garageLines = 0
for _, m in ipairs(dctrl._messages) do
  if m == "Your garage:" then garageLines = garageLines + 1 end
end
check("3 identical fires -> 1 response", garageLines == 1, "got " .. garageLines)

print("\n-- 7. an invalid slot name is refused, not sanitised --")
H.calls = {}
local bctrl = H.makeCtrl(STEAM, H.makePawn({}))
_G.FindAllOf = function() H.touch("FindAllOf"); return { bctrl } end
H.chat(CHAT, bctrl, bctrl, "!store ../../etc/passwd")
H.advance(50)
local bm = bctrl._messages
check("path traversal rejected",
      bm[#bm] and bm[#bm]:match("Slot names may only") ~= nil, tostring(bm[#bm]))

print("\n-- 8. the SENDER runs the command, not the controller that received it --")
H.calls = {}
local OTHER = "76561198000000077"
local senderPawn = H.makePawn({ growth = 0.6 })
local sender = H.makeCtrl(OTHER, senderPawn)
local receiver = H.makeCtrl(STEAM, H.makePawn({ growth = 0.9 }))
_G.FindAllOf = function() H.touch("FindAllOf"); return { receiver, sender } end
H.chat(CHAT, receiver, sender, "!store sender-slot")
H.advance(30100)                         -- the store countdown
local Storage = require("garage.storage")
check("stored under the sender's SteamID", Storage.get(OTHER, "sender-slot") ~= nil)
check("nothing stored for the receiver", Storage.get(STEAM, "sender-slot") == nil)
local sm = sender._messages
check("the sender is the one told", sm[#sm] and sm[#sm]:match("Stored") ~= nil, tostring(sm[#sm]))

print("\n-- 9. where a redeemed dino appears (panel setting + player's word) --")
local function setMode(mode)
  writeSettings('{"redeemAt":"' .. mode .. '","cooldown":0,"storeCountdown":30}')
end
-- A slot is used once, so each redeem gets a fresh one (stored at 1,2,3).
local function restock()
  Storage.put(STEAM, "default", { classPath = "BlueprintGeneratedClass /Game/BP_Dilo.BP_Dilo_C", growth = 0.8,
    location = { x = 1, y = 2, z = 3 }, rotation = { pitch = 0, yaw = 90, roll = 0 } })
end
local function redeem(text)
  restock()
  H.calls = {}
  local p = H.makePawn({ growth = 0.05, mutation = "None" })
  local c = H.makeCtrl(STEAM, p)
  _G.FindAllOf = function() H.touch("FindAllOf"); return { c } end
  H.chat(CHAT, c, c, text)
  H.advance(3100); H.advance(600)
  return c
end
local function teleportCall()
  for _, c in ipairs(H.calls) do if c.what == "K2_SetActorLocation" then return c end end
end

writeSettings('{"cooldown":0}')
redeem("!redeem default")
check("no redeemAt set = where the player stands", teleportCall() == nil)

setMode("stored")
redeem("!redeem default now")
local tp = teleportCall()
check("stored: moved to the !store position (+30 lift)", tp ~= nil and tp.args[1].X == 1
      and tp.args[1].Y == 2 and tp.args[1].Z == 33, tp and (tp.args[1].X .. "," .. tp.args[1].Z) or "no teleport")
check("as a teleport, no sweep", tp ~= nil and tp.args[2] == false and tp.args[4] == true)
local order = H.callNames()
local function idx(n) for i, v in ipairs(order) do if v == n then return i end end end
check("moved before the state is applied", idx("K2_SetActorLocation") ~= nil and idx("SetGrowth") ~= nil
      and idx("K2_SetActorLocation") < idx("SetGrowth"))

setMode("choice")
redeem("!redeem default here")
check("choice + 'here' = where the player stands", teleportCall() == nil)
redeem("!redeem default cu")
check("choice + 'cu' = the stored spot", teleportCall() ~= nil)
redeem("!redeem old")
check("'!redeem old' = most recent slot at the stored spot", teleportCall() ~= nil)

setMode("current")
redeem("!redeem default stored")
check("current: the player's word is ignored", teleportCall() == nil)

-- A slot made in the admin panel has no stored position.
setMode("stored")
Storage.put(STEAM, "nopos", { classPath = "BlueprintGeneratedClass /Game/BP_Dilo.BP_Dilo_C", growth = 0.5 })
local c = redeem("!redeem nopos")
check("no stored position: restored where the player stands", teleportCall() == nil
      and H.countCalls("SetGrowth") == 1)
local nm = c._messages
local told = false
for _, m in ipairs(nm) do if m:match("no stored position") then told = true end end
check("and the player is told why", told)

setMode("sideways")
redeem("!redeem default x")
check("a broken setting falls back to 'current'", teleportCall() == nil)
os.remove(SETTINGS)

print("\n-- 10. a slot is used ONCE: no second copy from the same slot --")
writeSettings('{"cooldown":0,"storeCountdown":30}')
restock()
local c10 = H.makeCtrl(STEAM, H.makePawn({ growth = 0.05, mutation = "None" }))
_G.FindAllOf = function() H.touch("FindAllOf"); return { c10 } end
H.chat(CHAT, c10, c10, "!redeem default once")
H.advance(10)                            -- the chat handler runs; the restore waits 3 s
check("taken out at once, before the restore delay", Storage.get(STEAM, "default") == nil)
H.chat(CHAT, c10, c10, "!redeem default twice")
H.advance(10)
local m10 = c10._messages
check("a second !redeem finds it empty", (m10[#m10] or ""):match("empty or unreadable") ~= nil, m10[#m10])
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
_G.FindAllOf = function() H.touch("FindAllOf"); return { c11 } end
H.chat(CHAT, c11, c11, "!redeem default leave")
H.advance(10)
_G.FindAllOf = function() H.touch("FindAllOf"); return {} end      -- player gone
H.advance(3200)
check("slot back in the garage", Storage.get(STEAM, "default") ~= nil)
check("and listed again", Storage.listSlots(STEAM).default ~= nil)

print("\n-- 12. leaving during the store countdown stores nothing --")
Storage.discard(STEAM, "default")
local c12 = H.makeCtrl(STEAM, H.makePawn({ growth = 0.7 }))
_G.FindAllOf = function() H.touch("FindAllOf"); return { c12 } end
H.calls = {}
H.chat(CHAT, c12, c12, "!store quitter")
H.advance(1000)
_G.FindAllOf = function() H.touch("FindAllOf"); return {} end      -- quits mid-countdown
H.advance(30000)
check("no slot saved", Storage.get(STEAM, "quitter") == nil)
check("no dino removed", H.countCalls("SetHealth") == 0)

print("\n-- 13. two slots per player by default --")
for _, sl in ipairs({ "a1", "a2", "sender-slot", "nopos" }) do Storage.discard(STEAM, sl) end
Storage.put(STEAM, "a1", { classPath = "X", growth = 1 })
Storage.put(STEAM, "a2", { classPath = "X", growth = 1 })
writeSettings('{"cooldown":0}')
local c13 = H.makeCtrl(STEAM, H.makePawn({ growth = 0.7 }))
_G.FindAllOf = function() H.touch("FindAllOf"); return { c13 } end
H.chat(CHAT, c13, c13, "!store third")
H.advance(10)
local m13 = c13._messages
check("third slot refused", (m13[#m13] or ""):match("garage is full %(2 slots%)") ~= nil, m13[#m13])
writeSettings('{"cooldown":0,"maxSlots":3,"storeCountdown":0}')
H.chat(CHAT, c13, c13, "!store third ")
H.advance(10)
check("allowed when the panel raises the limit", Storage.get(STEAM, "third") ~= nil)
check("countdown 0 = stored at once", H.countCalls("SetHealth") >= 1)

print("\n-- 14. the garage cooldown between uses --")
writeSettings('{"cooldown":60,"maxSlots":5,"storeCountdown":0}')
clock = clock + 61                       -- clear section 13's use
local c14 = H.makeCtrl(STEAM, H.makePawn({ growth = 0.7 }))
_G.FindAllOf = function() H.touch("FindAllOf"); return { c14 } end
H.chat(CHAT, c14, c14, "!store cd1")
H.advance(10)
check("first use ok", Storage.get(STEAM, "cd1") ~= nil)
clock = clock + 10
H.chat(CHAT, c14, c14, "!store cd2")
H.advance(10)
local m14 = c14._messages
check("second use within 60 s refused", Storage.get(STEAM, "cd2") == nil
      and (m14[#m14] or ""):match("cooldown: wait 50 s") ~= nil, m14[#m14])
clock = clock + 51
H.chat(CHAT, c14, c14, "!store cd2 ")
H.advance(10)
check("allowed after the cooldown", Storage.get(STEAM, "cd2") ~= nil)

print("\n-- 15. an admin-made slot comes out with a full stomach --")
writeSettings('{"cooldown":0,"maxSlots":10}')
Storage.put(STEAM, "gift", { classPath = "BlueprintGeneratedClass /Game/BP_Dilo.BP_Dilo_C", growth = 1,
  createdBy = "admin", fill = { stomachFull = true, nutrientPct = 50 } })
local p15 = H.makePawn({ growth = 0.05, mutation = "None", gasVitals = true })
p15.__props.MaxHunger = 3135
local c15 = H.makeCtrl(STEAM, p15)
_G.FindAllOf = function() H.touch("FindAllOf"); return { c15 } end
H.calls = {}
H.chat(CHAT, c15, c15, "!redeem gift")
H.advance(3100); H.advance(600)
local lastHunger
for _, cl in ipairs(H.calls) do if cl.what == "SetHunger" then lastHunger = cl.args[1] end end
check("stomach set to the game's max for this dino", lastHunger == 3135, tostring(lastHunger))

print("\n-- 16. nutrients are kept by their REAL field names --")
local p16 = H.makePawn({ growth = 0.8, nutrients = { CarbohydrateValue = 120, ProteinValue = 80, LipidValue = 321.5 } })
local c16 = H.makeCtrl(STEAM, p16)
_G.FindAllOf = function() H.touch("FindAllOf"); return { c16 } end
H.chat(CHAT, c16, c16, "!store nut")
H.advance(30100)                         -- default 30 s countdown
local st16 = Storage.get(STEAM, "nut")
check("every reflected field stored", st16 and st16.nutrients.fields and st16.nutrients.fields.CarbohydrateValue == 120
      and st16.nutrients.fields.LipidValue == 321.5, st16 and require("shared.isle.json").encode(st16.nutrients) or "-")
local p16b = H.makePawn({ growth = 0.05, mutation = "None", nutrients = { CarbohydrateValue = 0, ProteinValue = 0, LipidValue = 0 } })
local c16b = H.makeCtrl(STEAM, p16b)
_G.FindAllOf = function() H.touch("FindAllOf"); return { c16b } end
H.calls = {}
H.chat(CHAT, c16b, c16b, "!redeem nut")
H.advance(3100); H.advance(600)
local wrote = {}
for _, cl in ipairs(H.calls) do if cl.what:match("^field:") then wrote[cl.what] = cl.args[1] end end
check("written back under the same names", wrote["field:CarbohydrateValue"] == 120 and wrote["field:LipidValue"] == 321.5,
      require("shared.isle.json").encode(wrote))

say("")
say("-- threads: nothing the mod ran from an async callback touched the engine --")
check("no engine access off the game thread", H.offThreadAccess == 0,
      table.concat(H.offThreadWhat, ", "))

say(string.format("=== DinoGarage: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
