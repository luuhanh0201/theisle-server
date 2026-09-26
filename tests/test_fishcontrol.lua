-- FishControl: density set on the game's spawner (numbers only), put back when off;
-- a census of live fish by species while players are online.
local function say(s) io.write(tostring(s)) io.write(string.char(10)) end
local H = require("harness")
local json = require("shared.isle.json")
local pass, fail = 0, 0
local function check(name, ok, detail)
  if ok then pass = pass + 1; say("  ok   " .. name)
  else fail = fail + 1; say("  FAIL " .. name .. (detail and ("  -> " .. detail) or "")) end
end
os.execute('mkdir -p "' .. RUN .. '/Mods/FishControl/Saved"')
local SET, OUT = "Mods/FishControl/Saved/settings.json", "Mods/FishControl/Saved/fish.json"
os.remove(SET); os.remove(OUT)
local function settings(t) local f = io.open(SET, "w"); f:write(json.encode(t)); f:close() end
local ws = { IsValid = function() return true end, MaxAmbientFishPerPlayer = 12, AmbientFishSoftLimitPerWater = 28, AmbientFishSpawnCooldown = 0.5 }
local fishPawns = {}
local player = H.makeCtrl("76561190000000001", H.makePawn({}))
local online = true
_G.FindAllOf = function(c)
  if c == "TIAIWorldSpawner" then return { ws } end
  if c == "PlayerController" then return online and { player } or {} end
  if c == "Pawn" then return fishPawns end
  return {}
end
for _, cls in ipairs({ "BP_Catfish_C", "BP_Catfish_C", "BP_Muskel_C", "BP_Boar_C" }) do
  fishPawns[#fishPawns + 1] = H.makePawn({ class = "BlueprintGeneratedClass /Game/X/" .. cls:gsub("_C$", "") .. "." .. cls })
end

dofile(RUN .. "/Mods/FishControl/Scripts/main.lua")
local apply, census
for _, l in ipairs(H.gameLoops) do if l.ms == 30000 then apply = l elseif l.ms == 60000 then census = l end end
local writer = H.loops[#H.loops]
apply.fn()
check("off and never on: the game's numbers untouched", ws.MaxAmbientFishPerPlayer == 12 and ws.AmbientFishSpawnCooldown == 0.5)
settings({ control = true, perPlayer = 5, perWater = 10, cooldownSec = 3 })
apply.fn()
check("on: the admin's density", ws.MaxAmbientFishPerPlayer == 5 and ws.AmbientFishSoftLimitPerWater == 10 and ws.AmbientFishSpawnCooldown == 3)
settings({ control = true, perPlayer = 999, perWater = 10, cooldownSec = 3 })
apply.fn()
check("kept in range (60 at most)", ws.MaxAmbientFishPerPlayer == 60)
settings({ control = false })
apply.fn()
check("off: the game's own back", ws.MaxAmbientFishPerPlayer == 12 and ws.AmbientFishSoftLimitPerWater == 28 and ws.AmbientFishSpawnCooldown == 0.5)
census.fn(); writer.fn()
local f = io.open(OUT, "r"); local d = f and json.decode(f:read("*a")); if f then f:close() end
check("census: fish by species, not the boar", d and d.total == 3 and d.species.BP_Catfish_C == 2 and d.species.BP_Muskel_C == 1, d and json.encode(d) or "none")
os.remove(OUT)
online = false
census.fn(); writer.fn()
check("nobody online: no census", io.open(OUT, "r") == nil)
check("never off the game thread", H.offThreadAccess == 0, table.concat(H.offThreadWhat, ","))
os.remove(SET); os.remove(OUT)
say(string.format("=== FishControl: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
