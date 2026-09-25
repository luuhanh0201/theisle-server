-- PteraCarry step 1 (read-only discovery) against fake classes: lists the
-- carry-related functions and defaults, hooks only carry-looking functions,
-- logs their fires, changes nothing.

local function say(s) io.write(tostring(s)) io.write(string.char(10)) end
local H = require("harness")

local pass, fail = 0, 0
local function check(name, ok, detail)
  if ok then pass = pass + 1; say("  ok   " .. name)
  else fail = fail + 1; say("  FAIL " .. name .. (detail and ("  -> " .. detail) or "")) end
end

local function named(n, extra)
  local o = { IsValid = function() return true end,
    GetFName = function() return FName(n) end }
  for k, v in pairs(extra or {}) do o[k] = v end
  return o
end
local function prop(n, cls) return named(n, { GetClass = function() return named(cls or "BoolProperty") end }) end
local function fn(n, owner, params)
  return named(n, {
    GetFullName = function() return "Function /Script/TheIsle." .. owner .. ":" .. n end,
    ForEachProperty = function(_, cb) for _, p in ipairs(params or {}) do cb(prop(p, "ObjectProperty")) end end,
  })
end
local function class(n, fns, props, super, cdo)
  return named(n, {
    ForEachFunction = function(_, cb) for _, f in ipairs(fns) do cb(f) end end,
    ForEachProperty = function(_, cb) for _, p in ipairs(props) do cb(p) end end,
    GetSuperStruct = function() return super end,
    GetCDO = function() H.record("GetCDO"); return cdo end,
  })
end

local base = class("TIFlyingCharacter", {
  fn("ServerTryPickUpCarriable", "TIFlyingCharacter", { "Target" }),
  fn("ServerDropCarried", "TIFlyingCharacter"),
  fn("GetMaxCarryWeight", "TIFlyingCharacter"),        -- a getter: listed, never hooked
  fn("IsUseInputHeld", "TIFlyingCharacter"),           -- idem (runs every frame)
  fn("ServerFlap", "TIFlyingCharacter"),               -- unrelated
}, { prop("CarriedActor", "ObjectProperty"), prop("FlapSpeed", "FloatProperty") }, nil,
  { CarriedActor = nil, MaxCarryWeight = 25 })
local ptera = class("BP_Pteranodon_C", { fn("OnGrabbed", "BP_Pteranodon_C"), fn("ServerStartPerch", "BP_Pteranodon_C", { "Target" }) }, { prop("MaxCarryWeight", "FloatProperty") }, base,
  { MaxCarryWeight = 25, CarriedActor = nil })
local rabbit = class("BP_Rabbit_C", {}, { prop("bCanBeCarried"), prop("CarryWeight", "FloatProperty") }, nil,
  { bCanBeCarried = true, CarryWeight = 2 })
local classes = {
  ["/Game/TheIsle/Core/Characters/Dinosaurs/Pteranodon/BP_Pteranodon.BP_Pteranodon_C"] = ptera,
  ["/Game/TheIsle/Core/Characters/Animals/Rabbit/BP_Rabbit.BP_Rabbit_C"] = rabbit,
  ["/Script/GameplayAbilities.AbilitySystemComponent"] = named("AbilitySystemComponent"),
}
_G.StaticFindObject = function(p) return classes[p] end

dofile(RUN .. "/Mods/PteraCarry/Scripts/main.lua")
local loop = H.gameLoops[1]
check("a game-thread loop", loop ~= nil)
loop.fn()
local text = table.concat(H.log, "\n")
check("lists the carry functions with their params", text:find("function ServerTryPickUpCarriable%(Target:ObjectProperty%)") ~= nil)
check("…and properties", text:find("property CarriedActor : ObjectProperty", 1, true) ~= nil)
check("not the unrelated properties", text:find("FlapSpeed", 1, true) == nil)
check("hooks the pick-up / drop / grab functions", H.hooks["/Script/TheIsle.TIFlyingCharacter:ServerTryPickUpCarriable"] ~= nil
  and H.hooks["/Script/TheIsle.TIFlyingCharacter:ServerDropCarried"] ~= nil and H.hooks["/Script/TheIsle.BP_Pteranodon_C:OnGrabbed"] ~= nil)
check("the ptera's own Server RPCs are hooked, whatever their name", H.hooks["/Script/TheIsle.BP_Pteranodon_C:ServerStartPerch"] ~= nil)
check("…down to TIDinosaurBase (a parent at depth 1 too)", H.hooks["/Script/TheIsle.TIFlyingCharacter:ServerFlap"] ~= nil)
check("getters are listed but not hooked", text:find("function GetMaxCarryWeight", 1, true) ~= nil
  and H.hooks["/Script/TheIsle.TIFlyingCharacter:GetMaxCarryWeight"] == nil
  and H.hooks["/Script/TheIsle.TIFlyingCharacter:IsUseInputHeld"] == nil)
check("GAS: the ability RPCs are hooked (a key press that starts an ability)",
  H.hooks["/Script/GameplayAbilities.AbilitySystemComponent:ServerTryActivateAbility"] ~= nil
  and H.hooks["/Script/GameplayAbilities.AbilitySystemComponent:ServerSetInputPressed"] ~= nil)
check("never reads a class default object (it crashed the server)", H.countCalls("GetCDO") == 0)
local target = H.makePawn({ class = "BlueprintGeneratedClass /Game/X/BP_Rabbit.BP_Rabbit_C" })
local p = function(v) return { get = function() return v end } end
for _ = 1, 7 do H.fire("/Script/TheIsle.TIFlyingCharacter:ServerTryPickUpCarriable", p(named("self")), p(target)) end
local fires = 0
for _, l in ipairs(H.log) do if l:find("FIRED TIFlyingCharacter:ServerTryPickUpCarriable", 1, true) then fires = fires + 1 end end
check("a fire is logged with its params, the first 5 only", fires == 5, tostring(fires))
check("nothing changed in the game", #H.calls == 0 or (function()
  for _, c in ipairs(H.calls) do if c.what:match("^Set") or c.what:match("Destroy") then return false end end
  return true end)())
loop.fn()
local hooksNow = 0
for _ in pairs(H.hooks) do hooksNow = hooksNow + 1 end
check("run again: nothing hooked twice", hooksNow == 11, tostring(hooksNow))

-- A player on a Pteranodon, a rabbit 10 m away and one 200 m away.
local ptera = H.makePawn({ class = "BlueprintGeneratedClass /Game/X/BP_Pteranodon.BP_Pteranodon_C", loc = { X = 0, Y = 0, Z = 0 } })
local ctrl = H.makeCtrl("76561190000000001", ptera)
H.attachController(ptera, ctrl)
local near = H.makePawn({ class = "BlueprintGeneratedClass /Game/X/BP_Rabbit.BP_Rabbit_C", loc = { X = 1000, Y = 0, Z = 0 } })
local far = H.makePawn({ class = "BlueprintGeneratedClass /Game/X/BP_Rabbit.BP_Rabbit_C", loc = { X = 20000, Y = 0, Z = 0 } })
_G.FindAllOf = function(c) if c == "PlayerController" then return { ctrl } end; return { ptera, near, far } end
H.calls = {}
loop.fn()
text = table.concat(H.log, "\n")
check("live: the ptera's values", text:find("live ptera 76561190000000001", 1, true) ~= nil, text:sub(-400))
local preys = 0
for _, l in ipairs(H.log) do if l:find("prey BP_Rabbit_C at 10 m", 1, true) then preys = preys + 1 end end
check("…and the rabbit 10 m away, not the one 200 m away", preys == 1 and text:find("at 200 m", 1, true) == nil)
check("reading only: nothing set", (function()
  for _, c in ipairs(H.calls) do if c.what:match("^Set") then return false end end
  return true end)())

say(string.format("=== PteraCarry: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
