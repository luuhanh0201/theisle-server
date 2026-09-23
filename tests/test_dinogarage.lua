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

-- Load the mod exactly as UE4SS would.
local pawn = H.makePawn({ growth = 0.9, mutation = "MUT_Life" })
local ctrl = H.makeCtrl(STEAM, pawn)
_G.FindAllOf = function() H.touch("FindAllOf"); return { ctrl } end

dofile(RUN .. "/ue4ss/Mods/DinoGarage/Scripts/main.lua")

print("\n-- 1. mod loads and registers the chat hook --")
check("chat hook registered", H.hooks[CHAT] ~= nil)

print("\n-- 2. !store captures, persists, and DEFERS the kill --")
H.fire(CHAT, H.param(ctrl), H.param("!store"))
H.advance(10)                       -- let the deferWithPlayer(0) dispatch run
check("SetHealth not called yet", H.countCalls("SetHealth") == 0,
      "kill must wait 3s, got " .. H.countCalls("SetHealth"))

local slotFile = RUN .. "/ue4ss/Mods/DinoGarage/Saved/stored/" .. STEAM .. "__default.json"
local f = io.open(slotFile, "r")
check("slot file written before the kill", f ~= nil, slotFile)
local raw = f and f:read("*a") or ""
if f then f:close() end

local json = require("shared.isle.json")
local okDecode, state = pcall(json.decode, raw)
check("slot file is valid JSON", okDecode, tostring(state))
if okDecode then
  check("version = 1", state.version == 1, tostring(state.version))
  check("growth captured", state.growth == 0.9, tostring(state.growth))
  check("classPath captured", state.classPath ~= nil, tostring(state.classPath))
  check("active mutation captured", state.mutations.Slot1 == "MUT_Life",
        tostring(state.mutations.Slot1))
  check("inherited mutation captured", state.mutations.ParentSlot1 == "MUT_Parent",
        tostring(state.mutations.ParentSlot1))
  check("'None' slot stored as nil", state.mutations.Slot2 == nil,
        tostring(state.mutations.Slot2))
  check("elder stacks captured", state.elderStacks == 3, tostring(state.elderStacks))
  check("nutrients captured", state.nutrients.carbValue == 5,
        tostring(state.nutrients.carbValue))
end

print("\n-- 3. the kill fires after 3s --")
H.advance(3100)
check("SetHealth(0) called once", H.countCalls("SetHealth") == 1,
      tostring(H.countCalls("SetHealth")))
check("killed with 0", H.calls[#H.calls].args[1] == 0,
      tostring(H.calls[#H.calls].args[1]))

print("\n-- 4. !redeem on the WRONG species is refused --")
H.calls = {}
local wrongPawn = H.makePawn({ class = "BlueprintGeneratedClass /Game/BP_Carno.BP_Carno_C" })
local wrongCtrl = H.makeCtrl(STEAM, wrongPawn)
_G.FindAllOf = function() H.touch("FindAllOf"); return { wrongCtrl } end
H.fire(CHAT, H.param(wrongCtrl), H.param("!redeem"))
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
H.fire(CHAT, H.param(freshCtrl), H.param("!redeem default"))
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
H.fire(CHAT, H.param(dctrl), H.param("!garage"))
H.fire(CHAT, H.param(dctrl), H.param("!garage"))
H.fire(CHAT, H.param(dctrl), H.param("!garage"))
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
H.fire(CHAT, H.param(bctrl), H.param("!store ../../etc/passwd"))
H.advance(50)
local bm = bctrl._messages
check("path traversal rejected",
      bm[#bm] and bm[#bm]:match("Slot names may only") ~= nil, tostring(bm[#bm]))

say("")
say("-- threads: nothing the mod ran from an async callback touched the engine --")
check("no engine access off the game thread", H.offThreadAccess == 0,
      table.concat(H.offThreadWhat, ", "))

say(string.format("=== DinoGarage: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
