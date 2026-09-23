-- Minimal UE4SS stand-in: enough of the API surface for the mods to run.
local Harness = {}

Harness.log      = {}
Harness.hooks    = {}
Harness.timers   = {}   -- { at = ms, fn = fn }
Harness.loops    = {}
Harness.calls    = {}   -- ordered record of every engine call
Harness.now      = 0

-- Thread model. UE4SS runs hooks and ExecuteInGameThread callbacks on the game
-- thread, and ExecuteWithDelay / LoopAsync callbacks on its own async thread.
-- Engine objects may only be touched on the game thread, so every access to a
-- fake pawn or controller from async code is counted here.
Harness.onGameThread    = false
Harness.asyncDepth      = 0
Harness.offThreadAccess = 0
Harness.offThreadWhat   = {}

function Harness.touch(what)
  if Harness.asyncDepth > 0 and not Harness.onGameThread then
    Harness.offThreadAccess = Harness.offThreadAccess + 1
    Harness.offThreadWhat[#Harness.offThreadWhat + 1] = tostring(what)
  end
end

local function runOn(gameThread, fn, ...)
  local prevGT, prevDepth = Harness.onGameThread, Harness.asyncDepth
  Harness.onGameThread = gameThread
  Harness.asyncDepth = gameThread and 0 or prevDepth + 1
  local ok, err = pcall(fn, ...)
  Harness.onGameThread, Harness.asyncDepth = prevGT, prevDepth
  if not ok then error(err, 0) end
end

--- Run fn the way UE4SS runs a LoopAsync / ExecuteWithDelay callback.
function Harness.async(fn, ...) runOn(false, fn, ...) end

function Harness.reset()
  Harness.log, Harness.hooks, Harness.timers = {}, {}, {}
  Harness.loops, Harness.calls, Harness.now = {}, {}, 0
end

function Harness.record(what, ...)
  Harness.calls[#Harness.calls + 1] = { what = what, args = { ... } }
end

function Harness.callNames()
  local out = {}
  for _, c in ipairs(Harness.calls) do out[#out + 1] = c.what end
  return out
end

function Harness.countCalls(name)
  local n = 0
  for _, c in ipairs(Harness.calls) do if c.what == name then n = n + 1 end end
  return n
end

-- Advance virtual time, firing anything scheduled.
function Harness.advance(ms)
  local target = Harness.now + ms
  while true do
    local nextIdx, nextAt = nil, nil
    for i, t in ipairs(Harness.timers) do
      if not t.done and t.at <= target and (nextAt == nil or t.at < nextAt) then
        nextIdx, nextAt = i, t.at
      end
    end
    if nextIdx == nil then break end
    Harness.timers[nextIdx].done = true
    Harness.now = nextAt
    Harness.timers[nextIdx].fn()
  end
  Harness.now = target
end

-- ---- globals the mods expect -----------------------------------------
_G.print = function(...)
  local parts = {}
  for i = 1, select('#', ...) do parts[#parts + 1] = tostring(select(i, ...)) end
  Harness.log[#Harness.log + 1] = table.concat(parts)
end

_G.RegisterHook = function(name, fn)
  Harness.hooks[name] = Harness.hooks[name] or {}
  table.insert(Harness.hooks[name], fn)
end

_G.ExecuteWithDelay = function(ms, fn)
  Harness.timers[#Harness.timers + 1] = { at = Harness.now + ms, fn = function() Harness.async(fn) end }
end

-- loop.fn() runs the callback as the async thread would.
_G.LoopAsync = function(ms, fn)
  Harness.loops[#Harness.loops + 1] = { ms = ms, fn = function() Harness.async(fn) end }
end


-- Runs on the next advance(), not inline: the real one queues onto the game
-- thread, so anything captured before the hand-off may be stale by then.
_G.ExecuteInGameThread = function(fn)
  Harness.timers[#Harness.timers + 1] = { at = Harness.now, fn = function() runOn(true, fn) end }
end

_G.FName = function(s)
  return setmetatable({ _n = s }, { __index = { ToString = function(self) return self._n end } })
end

-- A hook parameter wrapper: UE4SS hands params as objects with :get()
function Harness.param(v) return { get = function() return v end } end

function Harness.fire(hookName, ...)
  local fns = Harness.hooks[hookName]
  assert(fns, "no hook registered for " .. hookName)
  -- Hooks fire on the game thread.
  for _, fn in ipairs(fns) do runOn(true, fn, ...) end
end

-- ---- fake pawn / controller ------------------------------------------
local function makeStruct(fields)
  return setmetatable({}, {
    __index = function(_, k) return fields[k] end,
    __newindex = function(_, k, v)
      Harness.record("field:" .. k, v)
      fields[k] = v
    end,
  })
end

function Harness.makePawn(opts)
  opts = opts or {}
  local props = {
    Health = opts.health or 100, Stamina = 80, Hunger = 70, Thirst = 65,
    Oxygen = 100, Blood = 100, Food = 40, WaterLevel = 30,
    LockedDamage = 0, RottenValue = 0,
    MaxHunger = 100, MaxFoodValue = 100, MaxThirst = 100, MaxStamina = 100,
    Growth = opts.growth or 0.9, bIsFemale = true,
  }
  local mutFields = {
    MutationSlot1 = _G.FName(opts.mutation or "MUT_Life"),
    MutationSlot2 = _G.FName("None"),
    ParentMutationSlot1 = _G.FName("MUT_Parent"),
  }
  local nutFields = { CarbValue = 5, ProteinValue = 9, bMalnutrition = false }

  local className = opts.class or "BlueprintGeneratedClass /Game/BP_Dilo.BP_Dilo_C"
  local methods = {}
  for _, m in ipairs({
    "SetGrowth","SetHealth","SetStamina","SetHunger","SetThirst","SetOxygen",
    "SetBlood","SetFood","SetWaterLevel","SetMaxHunger","SetMaxFoodValue",
    "SetMaxThirst","SetMaxStamina","ServerSetPrimeEligible",
    "SetReplicatedMutationsData","SetNutrientsStruct","SetElderReplicationStacks",
  }) do
    methods[m] = function(_, v)
      Harness.record(m, v)
      if m == "SetGrowth" then
        -- The real engine refills vitals on growth. Model it, so the test
        -- proves the second vitals pass is actually needed.
        props.Health = props.MaxHunger
        Harness.record("__vitals_wiped_by_growth")
      end
      if m == "SetHealth" then props.Health = v end
    end
  end
  methods.GetElderReplicationStacks = function() Harness.record("GetElderReplicationStacks"); return 3 end
  methods.GetClass = function()
    return { GetFullName = function() return className end,
             GetFName = function() return _G.FName(className) end }
  end
  methods.K2_GetActorLocation = function() return { X = 1, Y = 2, Z = 3 } end
  methods.K2_GetActorRotation = function() return { Pitch = 0, Yaw = 90, Roll = 0 } end
  methods.IsValid = function() return opts.valid ~= false end

  local mutStruct = makeStruct(mutFields)
  local nutStruct = makeStruct(nutFields)
  local controller = nil

  return setmetatable({}, {
    __index = function(_, k)
      if type(k) ~= "string" or k:sub(1, 1) ~= "_" then Harness.touch("pawn." .. tostring(k)) end
      if k == "ReplicatedMutationsData" then return mutStruct end
      if k == "NutrientsStruct" then return nutStruct end
      if k == "Controller" then return controller end
      if k == "__props" then return props end
      if k == "__attach" then return function(c) controller = c end end
      if methods[k] then return methods[k] end
      return props[k]
    end,
  })
end

--- Point a pawn back at its controller, as a possessed pawn does in-game.
-- A pawn with no controller stands in for AI.
function Harness.attachController(pawn, ctrl)
  pawn.__attach(ctrl)
end

function Harness.makeCtrl(steamId, pawn, name)
  local messages = {}
  local playerState = name and {
    IsValid = function() return true end,
    GetPlayerName = function() return { ToString = function() return name end } end,
  } or nil
  local ctrl
  ctrl = setmetatable({}, {
    __index = function(_, k)
      if type(k) ~= "string" or k:sub(1, 1) ~= "_" then Harness.touch("ctrl." .. tostring(k)) end
      if k == "Pawn" then return pawn end
      if k == "PlayerState" then return playerState end
      if k == "IsValid" then return function() return true end end
      if k == "GetSteamId" then
        return function() return { ToString = function() return steamId end } end
      end
      if k == "ClientMessage" then
        return function(_, msg) messages[#messages + 1] = msg end
      end
      if k == "_messages" then return messages end
      -- Possess a different pawn (or nil: spawn menu, disconnected body).
      if k == "__setPawn" then return function(p) pawn = p end end
      return nil
    end,
  })
  return ctrl
end

return Harness
