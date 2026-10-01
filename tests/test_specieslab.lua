-- Functional test: SpeciesLab (test server only) measures every species once,
-- skips the one that took the server down last time, and kills what it spawned.

local function say(s) io.write(tostring(s)) io.write(string.char(10)) end

local H = require("harness")

local pass, fail = 0, 0
local function check(name, ok, detail)
  if ok then pass = pass + 1; say("  ok   " .. name)
  else fail = fail + 1; say("  FAIL " .. name .. (detail and ("  -> " .. detail) or "")) end
end

os.execute("mkdir -p Mods/SpeciesLab/Saved")
local clock = 5000000
os.time = function() return clock end

-- "Crashed" while measuring Ceratosaurus last time.
local f = assert(io.open("Mods/SpeciesLab/Saved/Ceratosaurus.trying", "w")); f:write("1"); f:close()

local spawned, killed = {}, 0
local world = { IsValid = function() return true end }
local gs = { IsValid = function() return true end, GetWorld = function() return world end }
_G.FindFirstOf = function() return gs end
local statics = {
  IsValid = function() return true end,
  BeginDeferredActorSpawnFromClass = function(_, _, cls)
    local p = H.makePawn({ growth = 0.25 })
    rawset(p, "SetHealth", function(_, v) if v == 0 then killed = killed + 1 end end)
    spawned[#spawned + 1] = { cls = cls, pawn = p }
    return p
  end,
  FinishSpawningActor = function() end,
}
_G.StaticFindObject = function(path)
  if path:find("GameplayStatics", 1, true) then return statics end
  if path:find("Oviraptor", 1, true) then return nil end            -- not in this build
  return { IsValid = function() return true end, path = path }
end
_G.FindAllOf = function(cls)
  local out = {}
  for _, s in ipairs(spawned) do if s.cls.path:find(cls:gsub("_C$", ""), 1, true) then out[#out + 1] = s.pawn end end
  return out
end

dofile(RUN .. "/Mods/SpeciesLab/Scripts/main.lua")
local loop = H.gameLoops[#H.gameLoops]
check("one game-thread loop", loop ~= nil and loop.ms == 2000)

loop.fn()
check("waits START_AFTER_S before doing anything", #spawned == 0)
for _ = 1, 400 do clock = clock + 5; loop.fn() end

local json = require("shared.isle.json")
local rf = io.open("Mods/SpeciesLab/Saved/species.json", "r")
local res = rf and json.decode(rf:read("*a")).species or {}
if rf then rf:close() end
check("a playable species measured at every growth", res.Tyrannosaurus and res.Tyrannosaurus.status == "done"
      and #res.Tyrannosaurus.steps == 7 and res.Tyrannosaurus.spawned ~= nil, res.Tyrannosaurus and json.encode(res.Tyrannosaurus):sub(1, 200))
check("the maxima are read", res.Tyrannosaurus and res.Tyrannosaurus.steps[1].max.health == 100)
check("the species that crashed last time is skipped, not retried", res.Ceratosaurus
      and res.Ceratosaurus.status:find("SKIPPED", 1, true) ~= nil and io.open("Mods/SpeciesLab/Saved/Ceratosaurus.trying", "r") == nil)
check("a class the build does not have: reported, the run goes on", res.Oviraptor and res.Oviraptor.status == "class not found")
check("blueprint-only species tried too", res.Baryonyx and res.Baryonyx.status == "done")
check("24 spawned: 26 minus the skipped Ceratosaurus and the missing Oviraptor", #spawned == 24, #spawned)
check("every spawned dino killed after", killed == #spawned, killed .. "/" .. #spawned)
local leftover = false
for _, n in ipairs({ "Tyrannosaurus", "Baryonyx", "Allosaurus" }) do if io.open("Mods/SpeciesLab/Saved/" .. n .. ".trying", "r") then leftover = true end end
check("no flag left behind", not leftover)
check("a readable table too", io.open("Mods/SpeciesLab/Saved/species.txt", "r") ~= nil)
check("no engine access off the game thread", H.offThreadAccess == 0, table.concat(H.offThreadWhat or {}, ", "))

say(string.format("=== SpeciesLab: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
