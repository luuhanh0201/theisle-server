-- Flora — the island's real plants, for the admin map (step 1: read-only).
--
-- What PlantProbe found (2026-09-26): plants are actors.
--   TIEdibleSpawner  (BP_EdiblePlantsSpawnable_C, ~80) — an area (box, sphere
--                    or spline) that spawns edible plants; the migration and
--                    mass-migration zones are these (bShouldUseMigration,
--                    bBecameMassMigration, MigrationSpawnMultiplier…)
--   TIEdiblePlant    a plant (bushes, flowers, fruit trees): bCanGiveNutrients,
--                    Carb/Protein/LipidProportion, its Spawner
--   TIFruitBase      a fruit (mango, banana…): bCanGiveNutri
--
-- Every EXPORT_MS this writes Mods/Flora/Saved/flora.json: each spawner (where,
-- its shape, whether it is a migration zone and active / mass now) and every
-- plant and fruit (class, where, whether it gives nutrients, and its α/β/γ
-- proportions). The bridge serves it to the panel's map.
--
-- Read-only, and careful (lessons of 2026-09-24 and 2026-09-26):
--   * only numbers and booleans are read from these actors, plus the
--     components the game made for their shape (Box / Sphere / AreaSpline,
--     through their UFunctions) and the plant's Spawner — nothing else
--   * one family per game-thread tick (spawners, plants, fruits), found
--     fresh by FindAllOf in that tick; no actor kept across ticks
--   * a flag is written before the first export and removed after it: if
--     the server crashed in the middle, the next start does not export again
--   * the JSON is encoded and written on the async thread

if not package.path:find("Mods/?.lua", 1, true) then
    package.path = "Mods/?.lua;" .. package.path
end

local H    = require("shared.isle.helpers")
local json = require("shared.isle.json")

local MOD = "Flora"
local DIR = "Mods/Flora/Saved/"
local OUT = DIR .. "flora.json"
local FLAG = DIR .. "export.running"
local EXPORT_MS = 120000     -- a full picture every two minutes…
local STEP_MS = 3000         -- …built one family per tick, three ticks apart
local WRITE_MS = 5000
local SPLINE_POINTS = 64     -- at most, per spline area

local disabled = false
local firstDone = false
local picture = nil          -- being built: { spawners, plants, fruits }
local ready = nil            -- finished, waiting to be written
local shapes = {}            -- spawner address -> its shape (areas do not move)

local function num(obj, name)
    local ok, v = pcall(function() return obj[name] end)
    if ok and type(v) == "number" then return v end
    return nil
end

local function bool(obj, name)
    local ok, v = pcall(function() return obj[name] end)
    if ok and type(v) == "boolean" then return v end
    return nil
end

local function addressOf(obj)
    local ok, a = pcall(function() return obj:GetAddress() end)
    if ok and type(a) == "number" and a ~= 0 then return a end
    return nil
end

local function className(obj)
    local ok, n = pcall(function() return obj:GetClass():GetFName():ToString() end)
    return ok and n ~= nil and (tostring(n):match("([%w_]+)$") or tostring(n)) or "?"
end

local function where(obj)
    local ok, v = pcall(function() return obj:K2_GetActorLocation() end)
    if ok and v and type(v.X) == "number" then return math.floor(v.X + 0.5), math.floor(v.Y + 0.5) end
    return nil
end

local function r2(v) return v and math.floor(v * 100 + 0.5) / 100 or nil end

--- The area a spawner covers: its spline, else its box, else its sphere.
local function shapeOf(sp)
    local s = {}
    pcall(function()
        local spline = sp.AreaSpline
        if spline ~= nil and H.isValid(spline) then
            local n = spline:GetNumberOfSplinePoints()
            if type(n) == "number" and n >= 3 then
                local pts = {}
                local step = math.max(1, math.ceil(n / SPLINE_POINTS))
                for i = 0, n - 1, step do
                    local p = spline:GetLocationAtSplinePoint(i, 1)   -- ESplineCoordinateSpace::World
                    if p and type(p.X) == "number" then pts[#pts + 1] = { math.floor(p.X + 0.5), math.floor(p.Y + 0.5) } end
                end
                if #pts >= 3 then s.spline = pts end
            end
        end
    end)
    if s.spline then return s end
    pcall(function()
        local box = sp.Box
        if box ~= nil and H.isValid(box) then
            local e = box:GetScaledBoxExtent()
            local c = box:K2_GetComponentLocation()
            local r = box:K2_GetComponentRotation()
            if e and c and e.X > 1 and e.Y > 1 then
                s.box = { x = math.floor(c.X + 0.5), y = math.floor(c.Y + 0.5), ex = math.floor(e.X + 0.5), ey = math.floor(e.Y + 0.5), yaw = r2(r and r.Yaw or 0) }
            end
        end
    end)
    pcall(function()
        local sph = sp.Sphere
        if sph ~= nil and H.isValid(sph) then
            local rad = sph:GetScaledSphereRadius()
            local c = sph:K2_GetComponentLocation()
            if type(rad) == "number" and rad > 1 and c then
                s.sphere = { x = math.floor(c.X + 0.5), y = math.floor(c.Y + 0.5), r = math.floor(rad + 0.5) }
            end
        end
    end)
    return s
end

local function readSpawners()
    local list = {}
    local okA, all = pcall(function() return FindAllOf("TIEdibleSpawner") or {} end)
    for _, sp in ipairs(okA and all or {}) do
        if H.isValid(sp) then
            local a = addressOf(sp)
            local x, y = where(sp)
            if a and x then
                if shapes[a] == nil then shapes[a] = shapeOf(sp) end
                local okM, active = pcall(function() return sp:GetIsMigrationActive() end)
                list[#list + 1] = {
                    id = a, c = className(sp), x = x, y = y, shape = shapes[a],
                    migration = bool(sp, "bShouldUseMigration"), zonePlants = bool(sp, "bShouldZoneSpawnPlants"),
                    patrol = bool(sp, "bPatrolZone"), juvenile = bool(sp, "bJuvenilesZone"), nesting = bool(sp, "bNestingZone"),
                    here = bool(sp, "bMigrateHere"), mass = bool(sp, "bBecameMassMigration"),
                    active = okM and active == true,
                    multiplier = num(sp, "MigrationSpawnMultiplier"), amount = num(sp, "AmountToBeSpawned"),
                    minAmount = num(sp, "MinimumZoneAmountToBeSpawned"), activations = num(sp, "NumberOfActivations"),
                }
            end
        end
    end
    return list
end

local function readPlants()
    local list = {}
    local okA, all = pcall(function() return FindAllOf("TIEdiblePlant") or {} end)
    for _, p in ipairs(okA and all or {}) do
        if H.isValid(p) then
            local x, y = where(p)
            if x then
                local spawner = nil
                pcall(function() local s = p.Spawner; if s ~= nil and H.isValid(s) then spawner = addressOf(s) end end)
                list[#list + 1] = {
                    c = className(p), x = x, y = y, n = bool(p, "bCanGiveNutrients"), ft = num(p, "FoodType"),
                    cp = r2(num(p, "CarbProportion")), pp = r2(num(p, "ProteinProportion")), lp = r2(num(p, "LipidProportion")),
                    eaten = bool(p, "bWasConsumed"), s = spawner,
                }
            end
        end
    end
    return list
end

local function readFruits()
    local list = {}
    local okA, all = pcall(function() return FindAllOf("TIFruitBase") or {} end)
    for _, f in ipairs(okA and all or {}) do
        if H.isValid(f) then
            local x, y = where(f)
            if x then
                list[#list + 1] = {
                    c = className(f), x = x, y = y, n = bool(f, "bCanGiveNutri"), ft = num(f, "GoreFoodType"),
                    cp = r2(num(f, "CarbProportion")), pp = r2(num(f, "ProteinProportion")), lp = r2(num(f, "LipidProportion")),
                }
            end
        end
    end
    return list
end

local function markRunning(on)
    if on then
        local f = io.open(FLAG, "w")
        if f then f:write(tostring(os.time())); f:close() end
    else
        os.remove(FLAG)
    end
end

-- One family per tick; the picture is handed to the writer when complete.
local stage = 0
local nextAt = 0
local function step()
    if disabled then return end
    local now = os.time() * 1000
    if stage == 0 then
        if now < nextAt then return end
        if not firstDone then markRunning(true) end
        picture = { t = os.time(), spawners = readSpawners() }
        stage = 1
    elseif stage == 1 then
        picture.plants = readPlants()
        stage = 2
    elseif stage == 2 then
        picture.fruits = readFruits()
        ready, picture = picture, nil
        stage = 0
        nextAt = now + EXPORT_MS
        if not firstDone then
            firstDone = true
            markRunning(false)
            H.log(string.format("%s: first export — %d spawners, %d plants, %d fruits", MOD,
                #ready.spawners, #ready.plants, #ready.fruits))
        end
    end
end

local function write()
    if ready == nil then return end
    local data = ready
    ready = nil
    local ok, text = pcall(json.encode, data)
    if not ok then H.logError(MOD .. ": cannot encode: " .. tostring(text)); return end
    local tmp = OUT .. ".tmp"
    local f = io.open(tmp, "w")
    if not f then H.logError(MOD .. ": cannot write " .. tmp .. " (does " .. DIR .. " exist?)"); return end
    f:write(text)
    f:close()
    os.remove(OUT)
    os.rename(tmp, OUT)
end

local crashed = io.open(FLAG, "r")
if crashed then
    crashed:close()
    disabled = true
    H.logError(MOD .. ": the last export did not finish (the server stopped during it) — exports are off. "
        .. "Delete " .. FLAG .. " to try again.")
else
    H.every(STEP_MS, MOD .. " export", step)
    LoopAsync(WRITE_MS, function() write(); return false end)
    H.log(MOD .. ": loaded — exporting plants every " .. (EXPORT_MS // 1000) .. " s to " .. OUT)
end
