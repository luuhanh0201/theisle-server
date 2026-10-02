-- DinoGarage mutation.lua: a mutation item from a player's bag, into the slot
-- they chose on the dino they play now; a mutation the dino has already (any
-- slot) refused; a quest mutation unlocked first; bad arguments refused.
local function say(s) io.write(tostring(s)) io.write(string.char(10)) end
local H = require("harness")
local pass, fail = 0, 0
local function check(name, ok, detail)
  if ok then pass = pass + 1; say("  ok   " .. name)
  else fail = fail + 1; say("  FAIL " .. name .. (detail and ("  -> " .. detail) or "")) end
end
local Mutation = require("garage.mutation")

say("-- 1. into the slot chosen --")
local p = H.makePawn({ mutation = "MUT_Life" })     -- slot 1 MUT_Life, slot 2 None, parent 1 MUT_Parent
H.calls = {}
local ok, line, prev = Mutation.apply(p, "Cellular Regeneration", 2, false)
check("ok, with a line for the player", ok and line:find("Cellular Regeneration", 1, true) ~= nil, tostring(line))
check("slot 2 holds it now", p.ReplicatedMutationsData.MutationSlot2:ToString() == "Cellular Regeneration")
check("an empty slot said so", prev == "None" and line:find("ô trống", 1, true) ~= nil, tostring(prev))
check("pushed to the game and the player's screen", H.countCalls("SetReplicatedMutationsData") == 1 and H.countCalls("ClientUpdateMutations") == 1)
check("slot 1 untouched", p.ReplicatedMutationsData.MutationSlot1:ToString() == "MUT_Life")

say("-- 2. the dino has it in one of its four slots: refused (the bag offers the upgrade) --")
H.calls = {}
ok, line = Mutation.apply(p, "cellular regeneration", 4, false)  -- the one just put in slot 2, other case
check("refused, pointing at the upgrade", ok == false and line:find("ô 2", 1, true) ~= nil and line:find("Nâng cấp", 1, true) ~= nil, tostring(line))
check("nothing pushed", H.countCalls("SetReplicatedMutationsData") == 0)
ok = Mutation.apply(p, "Parent", 3, false)                       -- MUT_Parent only in an inherited slot
check("only in an inherited slot: may go in a slot", ok == true and p.ReplicatedMutationsData.MutationSlot3:ToString() == "Parent")

say("-- 3. a quest mutation is unlocked first --")
p = H.makePawn({ mutation = "MUT_Life", unlocks = { "Traumatic Thrombosis" } })
H.calls = {}
ok = Mutation.apply(p, "Osteophagic", 3, true)
local names = p.MutationsRequirementsData.UnlockRequiredMutations.__names
local unlocked = false
for _, n in ipairs(names) do if n == "Osteophagic" then unlocked = true end end
check("unlocked, then in slot 3", ok and unlocked and p.ReplicatedMutationsData.MutationSlot3:ToString() == "Osteophagic", table.concat(names, ","))

say("-- 4. upgrade: +1 đời when the dino has it, within its max, from the stacks the player saw --")
local function withStacks(n)
  local q = H.makePawn({ mutation = "MUT_Life" })
  local stacks = n
  q.GetElderReplicationStacks = function() return stacks end
  q.SetElderReplicationStacks = function(_, v) H.record("SetElderReplicationStacks", v); stacks = v end
  return q, function() return stacks end
end
local q, now = withStacks(1)
H.calls = {}
local okU, lineU, before, after = Mutation.upgrade(q, "Life", 1, 2)
check("đời 2 → 3", okU and before == 1 and after == 2 and now() == 2 and lineU:find("đời 3", 1, true) ~= nil, tostring(lineU))
check("only the stacks written, no slot", H.countCalls("SetElderReplicationStacks") == 1 and H.countCalls("SetReplicatedMutationsData") == 0)
okU, lineU = Mutation.upgrade(q, "Life", 2, 2)
check("at its max: refused, said so", okU == false and lineU:find("đã max", 1, true) ~= nil and now() == 2, tostring(lineU))
q, now = withStacks(0)
okU, lineU = Mutation.upgrade(q, "Parent", 1, 2)               -- the player saw đời 2, the dino is đời 1 now
check("the generation changed since the player looked: refused", okU == false and lineU:find("vừa đổi", 1, true) ~= nil and now() == 0, tostring(lineU))
okU, lineU = Mutation.upgrade(q, "Parent", 0, 2)
check("an inherited slot counts as having it", okU == true and now() == 1, tostring(lineU))
okU, lineU = Mutation.upgrade(q, "Hydrodynamic", 1, 2)
check("not on the dino: refused", okU == false and lineU:find("chưa có", 1, true) ~= nil and now() == 1, tostring(lineU))

say("-- 4b. the slot must be open at the dino's growth (the game's 25 / 50 / 75 / 75 %) --")
p = H.makePawn({ mutation = "MUT_Life", growth = 0.6 })
H.calls = {}
ok, line = Mutation.apply(p, "Hydrodynamic", 3, false, 0.75)
check("slot 3 at 60 %: refused, said why", ok == false and line:find("75%", 1, true) ~= nil and H.countCalls("SetReplicatedMutationsData") == 0, tostring(line))
ok = Mutation.apply(p, "Hydrodynamic", 2, false, 0.5)
check("slot 2 at 60 %: in", ok == true and p.ReplicatedMutationsData.MutationSlot2:ToString() == "Hydrodynamic")

say("-- 4c. Phiếu bỏ mutation: the slot emptied; an empty slot refused --")
local was
ok, line, was = Mutation.clear(p, 2)
check("slot 2 emptied", ok and was == "Hydrodynamic" and p.ReplicatedMutationsData.MutationSlot2:ToString() == "None", tostring(line))
ok, line = Mutation.clear(p, 2)
check("already empty: refused", ok == false and line:find("trống", 1, true) ~= nil, tostring(line))
check("slot 9 refused", (Mutation.clear(p, 9)) == false)

say("-- 5. bad arguments --")
check("slot 5 refused", (Mutation.apply(H.makePawn({}), "Hydrodynamic", 5, false)) == false)
check("no name refused", (Mutation.apply(H.makePawn({}), "", 1, false)) == false)

say(string.format("=== Mutation: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
