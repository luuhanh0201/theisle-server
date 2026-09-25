-- Minimal UE4SS stand-in: enough of the API surface for the mods to run.
local Harness = {}

Harness.log      = {}
Harness.hooks    = {}
Harness.timers   = {}   -- { at = ms, fn = fn }
Harness.loops    = {}
Harness.gameLoops = {}  -- LoopInGameThreadWithDelay: { ms, fn } — tests tick them with fn()
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
--- Run fn on the game thread (a hook, a game-thread loop).
function Harness.game(fn, ...) runOn(true, fn, ...) end

function Harness.reset()
  Harness.log, Harness.hooks, Harness.timers = {}, {}, {}
  Harness.loops, Harness.calls, Harness.now = {}, {}, 0
  Harness.gameLoops = {}
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

-- The delayed-action API of newer UE4SS builds (the experimental one on the
-- server has it): callbacks run ON the game thread, registered once.
_G.ExecuteInGameThreadWithDelay = function(ms, fn)
  Harness.timers[#Harness.timers + 1] = { at = Harness.now + ms, fn = function() runOn(true, fn) end }
  return #Harness.timers
end
-- Not scheduled on timers: a test ticks a game loop itself with gameLoops[i].fn(),
-- which runs one iteration on the game thread.
_G.LoopInGameThreadWithDelay = function(ms, fn)
  Harness.gameLoops[#Harness.gameLoops + 1] = { ms = ms, fn = function() runOn(true, fn) end }
  return #Harness.gameLoops
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
--- A struct value. With `reflected`, it also answers
--- :GetProperty():GetStruct():ForEachProperty() like UE4SS does, listing
--- `reflected` as its field names.
local function makeStruct(fields, reflected)
  return setmetatable({}, {
    __index = function(_, k)
      if k == "GetProperty" and reflected then
        return function() return { GetStruct = function() return { ForEachProperty = function(_, fn)
          for _, name in ipairs(reflected) do fn({ GetFName = function() return _G.FName(name) end }) end
        end } end } end
      end
      return fields[k]
    end,
    __newindex = function(_, k, v)
      Harness.record("field:" .. k, v)
      fields[k] = v
    end,
  })
end

local GAS_VITALS = {
  Health = true, Stamina = true, Hunger = true, Thirst = true, Oxygen = true,
  Blood = true, MaxHunger = true, MaxThirst = true, MaxStamina = true,
}

function Harness.makePawn(opts)
  opts = opts or {}
  local props = {
    Health = opts.health or 100, Stamina = 80, Hunger = 70, Thirst = 65,
    Oxygen = 100, Blood = 100, Food = 40, WaterLevel = 30,
    LockedDamage = 0, RottenValue = 0,
    MaxHunger = 100, MaxFoodValue = 100, MaxThirst = 100, MaxStamina = 100,
    MaxHealth = 100, MaxBlood = 100, MaxOxygen = 100,
    Growth = opts.growth or 0.9, bIsFemale = true,
    -- Where the pawn is, and how CharacterMovement reports it (tests move it).
    Loc = opts.loc or { X = 1, Y = 2, Z = 3 },
    Grounded = opts.grounded ~= false, Falling = false, Swimming = false,
  }
  local mutFields = {
    MutationSlot1 = _G.FName(opts.mutation or "MUT_Life"),
    MutationSlot2 = _G.FName("None"),
    ParentMutationSlot1 = _G.FName("MUT_Parent"),
  }
  -- The live struct has no "CarbValue" (the old guessed name); tests that
  -- pass opts.nutrients get a reflected struct with the given real fields.
  local nutFields = opts.nutrients or { CarbValue = 5, ProteinValue = 9, bMalnutrition = false }
  local nutNames = nil
  if opts.nutrients then
    nutNames = {}
    for k in pairs(opts.nutrients) do nutNames[#nutNames + 1] = k end
    table.sort(nutNames)
  end

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
  -- Read-only getters, as on the live pawn. Not recorded: reading is not a call
  -- that changes the world.
  for _, v in ipairs({ "Health", "Stamina", "Hunger", "Thirst", "Oxygen", "Blood",
                       "MaxHunger", "MaxThirst", "MaxStamina", "MaxHealth", "MaxBlood",
                       "MaxOxygen", "Growth" }) do
    methods["Get" .. v] = function() return props[v] end
  end
  methods.GetElderReplicationStacks = function() Harness.record("GetElderReplicationStacks"); return 3 end
  methods.GetClass = function()
    return { GetFullName = function() return className end,
             GetFName = function() return _G.FName(className) end }
  end
  methods.K2_GetActorLocation = function() return { X = props.Loc.X, Y = props.Loc.Y, Z = props.Loc.Z } end
  methods.IsPrimeElder = function() return opts.prime == true end
  methods.GetIsEligiblePrimeElder = function() return opts.eligible == true end
  local movement = {
    IsValid = function() return true end,
    IsMovingOnGround = function() return props.Grounded end,
    IsFalling = function() return props.Falling end,
    IsSwimming = function() return props.Swimming end,
  }
  -- Teleports are recorded with their arguments so tests can check where to.
  methods.K2_SetActorLocation = function(_, loc, sweep, hit, teleport)
    Harness.record("K2_SetActorLocation", loc, sweep, hit, teleport)
    props.Loc = { X = loc.X, Y = loc.Y, Z = loc.Z }
    return true
  end
  methods.K2_SetActorRotation = function(_, rot, teleport)
    Harness.record("K2_SetActorRotation", rot, teleport); return true
  end
  methods.K2_GetActorRotation = function() return { Pitch = 0, Yaw = 90, Roll = 0 } end
  methods.IsValid = function() return opts.valid ~= false end
  -- A stable identity per fake pawn, like the real object's address.
  Harness.nextAddress = (Harness.nextAddress or 4096) + 64
  local address = Harness.nextAddress
  methods.GetAddress = function() return address end

  local mutStruct = makeStruct(mutFields)
  local nutStruct = makeStruct(nutFields, nutNames)
  -- pawn.CustomizerData, as reflection lists it (tests may recolour __skin).
  local skinFields = {
    BodyColor = { R = 0.5, G = 0.25, B = 0.1, A = 1 },
    MarkingsColor = { R = 0.05, G = 0.05, B = 0.05, A = 1 },
    UnderbellyColor = { R = 0.8, G = 0.7, B = 0.6, A = 1 },
    PatternIndex = 3, ThemeIndex = 0, SkinVariation = 0.4, bIsFemale = true,
    SkinCode = "abc",
  }
  -- pawn.EligiblePrimeElderData: conditions 3, 8 and 9 met, as on the live server.
  local primeData = { bIsEligiblePrime = false }
  for i = 1, 10 do primeData["bPrimeCondition" .. i] = (i == 3 or i == 8 or i == 9) end
  local skinStruct = makeStruct(skinFields,
    { "bIsFemale", "SkinVariation", "PatternIndex", "ThemeIndex", "BodyColor", "MarkingsColor", "UnderbellyColor", "SkinCode" })
  local controller = nil

  return setmetatable({}, {
    __index = function(_, k)
      if type(k) ~= "string" or k:sub(1, 1) ~= "_" then Harness.touch("pawn." .. tostring(k)) end
      if k == "ReplicatedMutationsData" then return mutStruct end
      if k == "NutrientsStruct" then return nutStruct end
      if k == "CustomizerData" then return skinStruct end
      if k == "EligiblePrimeElderData" then return primeData end
      if k == "__skin" then return skinFields end
      if k == "__prime" then return primeData end
      if k == "Controller" then return controller end
      if k == "CharacterMovement" then return movement end
      if k == "__props" then return props end
      if k == "__attach" then return function(c) controller = c end end
      if methods[k] then return methods[k] end
      -- opts.gasVitals: like the live server, vitals live in GAS attribute sets
      -- and are NOT pawn properties — only the getters see them.
      if opts.gasVitals and GAS_VITALS[k] then return nil end
      return props[k]
    end,
  })
end

--- Point a pawn back at its controller, as a possessed pawn does in-game.
-- A pawn with no controller stands in for AI.
function Harness.attachController(pawn, ctrl)
  pawn.__attach(ctrl)
end

--- Messages the mods sent this player: the "notify" events in the events file
-- (the bridge turns those into RCON DirectMessages). Read fresh on each access.
local function notifiesFor(steamId)
  local out = {}
  local f = io.open("Mods/StatsLogger/Saved/events.ndjson", "r")
  if not f then return out end
  local json = require("shared.isle.json")
  for line in f:lines() do
    local ok, e = pcall(json.decode, line)
    if ok and type(e) == "table" and e.type == "notify" and e.steamId == steamId then
      out[#out + 1] = e.message
    end
  end
  f:close()
  return out
end

--- An FText as UE4SS hands it to Lua: ToString() gives the words, tostring()
--- only an address — the difference that broke every chat command.
function Harness.ftext(text)
  return setmetatable({ ToString = function() return text end },
    { __tostring = function() return "FText: 0000733DB33B7B08" end })
end

--- Fire GetChatMessage the way the game does: on the RECEIVING controller
--- (self), with (NewText, ChatPlayerController = sender, ChatMode, NoFilterMsg).
function Harness.chat(hook, receiver, sender, text)
  Harness.fire(hook, Harness.param(receiver), Harness.param(Harness.ftext(text)),
    Harness.param(sender), Harness.param(0), Harness.param(Harness.ftext(text)))
end

function Harness.makeCtrl(steamId, pawn, name)
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
      if k == "_messages" then return notifiesFor(steamId) end
      -- Possess a different pawn (or nil: spawn menu, disconnected body).
      if k == "__setPawn" then return function(p) pawn = p end end
      return nil
    end,
  })
  return ctrl
end

return Harness
