-- FishProbe: read-only; the fish class list is read only when it is a plain array of classes.
local function say(s) io.write(tostring(s)) io.write(string.char(10)) end
local H = require("harness")
local pass, fail = 0, 0
local function check(name, ok, detail)
  if ok then pass = pass + 1; say("  ok   " .. name)
  else fail = fail + 1; say("  FAIL " .. name .. (detail and ("  -> " .. detail) or "")) end
end
os.execute('mkdir -p "' .. RUN .. '/Mods/AIZones/Saved"')
local FLAG, OUT = "Mods/AIZones/Saved/fishprobe.flag", "Mods/AIZones/Saved/fishprobe.txt"
os.remove(FLAG); os.remove(OUT)
local function named(n, t) t = t or {}; t.GetFName = function() return FName(n) end; t.IsValid = function() return true end; return t end
local innerType = "ClassProperty"
local arrProp = named("AIAmbientFishClasses", { GetClass = function() return named("ArrayProperty") end,
  GetInner = function() return { GetClass = function() return named(innerType) end } end })
local wsCls = named("BP_WorldAISpawner_C", { ForEachProperty = function(_, cb) cb(arrProp) end, GetSuperStruct = function() return nil end })
local read = 0
local ws = named("ws", { GetClass = function() return wsCls end, MaxAmbientFishPerPlayer = 8, AmbientFishSpawnCooldown = 12.5,
  AIAmbientFishClasses = { ForEach = function(_, cb) read = read + 1
    cb(1, { get = function() return named("BP_Salmon_C") end }); cb(2, { get = function() return named("BP_Piranha_C") end }) end } })
_G.FindAllOf = function(c) if c == "TIAIWorldSpawner" then return { ws } end return {} end
dofile(RUN .. "/Mods/FishProbe/Scripts/main.lua")
H.advance(130000)
local f = io.open(OUT, "r"); local text = f and f:read("*a") or ""; if f then f:close() end
check("settings read (numbers)", text:find("MaxAmbientFishPerPlayer = 8", 1, true) ~= nil, text:sub(1, 200))
check("a plain array of classes: the fish list", text:find("BP_Salmon_C, BP_Piranha_C", 1, true) ~= nil)
check("flag written", io.open(FLAG, "r") ~= nil)
-- A soft class array is described, never read.
os.remove(FLAG); os.remove(OUT); read = 0; innerType = "SoftClassProperty"
dofile(RUN .. "/Mods/FishProbe/Scripts/main.lua")
H.advance(130000)
f = io.open(OUT, "r"); text = f and f:read("*a") or ""; if f then f:close() end
check("a soft class array: described, not read", read == 0 and text:find("SoftClassProperty", 1, true) ~= nil, text)
check("never off the game thread", H.offThreadAccess == 0, table.concat(H.offThreadWhat, ","))
os.remove(FLAG); os.remove(OUT)
say(string.format("=== FishProbe: %d passed, %d failed ===", pass, fail))
io.flush()
os.exit(fail == 0 and 0 or 1, true)
