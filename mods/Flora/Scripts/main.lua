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
-- Step 2 — control (off until the panel turns it on, settings.json from the
-- bridge): nutrient plants only where herbivores migrate.
--   * a plant / fruit gives nutrients only inside an ACTIVE migration area:
--     `migrationNutrientPct` of them there, `massNutrientPct` in a mass
--     migration, none outside (SetCanGiveNutrients — the game's own call;
--     which ones is fixed by each actor's address, so it does not flicker)
--   * how many grow: the game's MigrationSpawnMultiplier for active / mass
--     areas; outside, `outsideAmountPct` of the plain areas' AmountToBeSpawned
--     and of the fruit trees' fruit counts
--   * the game's own values are remembered and put back when it is turned off
--   * checked every CONTROL_MS (plants keep growing back), one family per tick;
--     numbers and booleans only; a flag against a crash loop, as for exports
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
local stats = nil            -- the last control round's counts (step 2), exported with the picture
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

local function markRunning(on, flag)
    flag = flag or FLAG
    if on then
        local f = io.open(flag, "w")
        if f then f:write(tostring(os.time())); f:close() end
    else
        os.remove(flag)
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
        picture.control = stats
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

--------------------------------------------------------------------------
-- Step 2: control
--------------------------------------------------------------------------

local SETTINGS_PATH = DIR .. "settings.json"
local CONTROL_FLAG = DIR .. "control.running"
local CONTROL_MS = 15000
local SETTINGS_RELOAD_S = 10
local CDEF = { control = false, migrationNutrientPct = 40, migrationMultiplier = 1,
               massNutrientPct = 100, massMultiplier = 3, outsideAmountPct = 30 }

local settings, settingsAt = CDEF, nil
local function clamp(v, lo, hi, d)
    local n = tonumber(v)
    if n == nil then return d end
    return math.max(lo, math.min(hi, math.floor(n + 0.5)))
end
local function readSettings()
    local now = os.time()
    if settingsAt ~= nil and now - settingsAt < SETTINGS_RELOAD_S then return settings end
    settingsAt = now
    local f = io.open(SETTINGS_PATH, "r")
    if not f then settings = CDEF; return settings end
    local raw = f:read("*a")
    f:close()
    local ok, d = pcall(json.decode, raw or "")
    if not ok or type(d) ~= "table" then return settings end
    settings = {
        control = d.control == true,
        migrationNutrientPct = clamp(d.migrationNutrientPct, 0, 100, CDEF.migrationNutrientPct),
        migrationMultiplier = clamp(d.migrationMultiplier, 1, 10, CDEF.migrationMultiplier),
        massNutrientPct = clamp(d.massNutrientPct, 0, 100, CDEF.massNutrientPct),
        massMultiplier = clamp(d.massMultiplier, 1, 20, CDEF.massMultiplier),
        outsideAmountPct = clamp(d.outsideAmountPct, 0, 100, CDEF.outsideAmountPct),
    }
    return settings
end

-- The game's own values, first seen before we changed them (by address).
local orig = { multiplier = {}, amount = {}, minAmount = {}, fruitsMin = {}, fruitsMax = {} }
local zones = {}          -- spawner address -> { active, mass, ring } (this control round)
local activeRings = {}    -- rings of the active / mass areas, for fruits and plants without a spawner
local applied = false     -- the control has changed something that needs putting back
local controlStage = 0
local controlFirst = true

local function remember(tbl, a, v) if tbl[a] == nil and v ~= nil then tbl[a] = v end end

local function setInt(obj, name, v)
    local cur = num(obj, name)
    if cur == nil or cur == v then return false end
    return pcall(function() obj[name] = v end)
end

local function setNutrients(obj, want, current)
    if current == want then return false end
    return pcall(function() obj:SetCanGiveNutrients(want) end)
end

local function inRing(ring, x, y)
    local inside, j = false, #ring
    for i = 1, #ring do
        local xi, yi, xj, yj = ring[i][1], ring[i][2], ring[j][1], ring[j][2]
        if (yi > y) ~= (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi then inside = not inside end
        j = i
    end
    return inside
end

--- How many in 100 give nutrients at (spawner state / place): 0 outside.
local function pctFor(z, s)
    if z == nil then return 0 end
    if z.mass then return s.massNutrientPct end
    if z.active then return s.migrationNutrientPct end
    return 0
end
local function pctAt(x, y, s)
    for _, r in ipairs(activeRings) do
        local b = r.box
        if x >= b[1] and x <= b[3] and y >= b[2] and y <= b[4] and inRing(r.ring, x, y) then return r.mass and s.massNutrientPct or s.migrationNutrientPct end
    end
    return 0
end
local function chosen(a, pct) return pct >= 100 or (pct > 0 and a % 100 < pct) end

local function controlSpawners(s, on)
    zones, activeRings = {}, {}
    local okA, all = pcall(function() return FindAllOf("TIEdibleSpawner") or {} end)
    for _, sp in ipairs(okA and all or {}) do
        local a = H.isValid(sp) and addressOf(sp)
        if a then
            local okM, active = pcall(function() return sp:GetIsMigrationActive() end)
            local z = { active = okM and active == true, mass = bool(sp, "bBecameMassMigration") == true,
                migration = bool(sp, "bShouldUseMigration") == true }
            zones[a] = z
            if shapes[a] == nil then shapes[a] = shapeOf(sp) end
            if (z.active or z.mass) and shapes[a].spline then
                local ring = shapes[a].spline
                local bx0, by0, bx1, by1 = math.huge, math.huge, -math.huge, -math.huge
                for _, q in ipairs(ring) do
                    bx0, by0, bx1, by1 = math.min(bx0, q[1]), math.min(by0, q[2]), math.max(bx1, q[1]), math.max(by1, q[2])
                end
                activeRings[#activeRings + 1] = { ring = ring, mass = z.mass, box = { bx0, by0, bx1, by1 } }
            end
            remember(orig.multiplier, a, num(sp, "MigrationSpawnMultiplier"))
            remember(orig.amount, a, num(sp, "AmountToBeSpawned"))
            remember(orig.minAmount, a, num(sp, "MinimumZoneAmountToBeSpawned"))
            if on then
                if z.mass then setInt(sp, "MigrationSpawnMultiplier", s.massMultiplier)
                elseif z.active then setInt(sp, "MigrationSpawnMultiplier", s.migrationMultiplier)
                elseif orig.multiplier[a] then setInt(sp, "MigrationSpawnMultiplier", orig.multiplier[a]) end
                if not z.migration and orig.amount[a] then
                    setInt(sp, "AmountToBeSpawned", math.floor(orig.amount[a] * s.outsideAmountPct / 100 + 0.5))
                    if orig.minAmount[a] then setInt(sp, "MinimumZoneAmountToBeSpawned", math.floor(orig.minAmount[a] * s.outsideAmountPct / 100 + 0.5)) end
                end
            else
                if orig.multiplier[a] then setInt(sp, "MigrationSpawnMultiplier", orig.multiplier[a]) end
                if orig.amount[a] then setInt(sp, "AmountToBeSpawned", orig.amount[a]) end
                if orig.minAmount[a] then setInt(sp, "MinimumZoneAmountToBeSpawned", orig.minAmount[a]) end
            end
        end
    end
end

local function controlPlants(s, on)
    local okA, all = pcall(function() return FindAllOf("TIEdiblePlant") or {} end)
    local st = { plants = 0, plantsNutri = 0 }
    for _, p in ipairs(okA and all or {}) do
        local a = H.isValid(p) and addressOf(p)
        if a then
            st.plants = st.plants + 1
            local want = true
            if on then
                local zone = nil
                pcall(function() local sp = p.Spawner; if sp ~= nil and H.isValid(sp) then zone = zones[addressOf(sp)] end end)
                local pct
                if zone ~= nil then pct = pctFor(zone, s)
                else local x, y = where(p); pct = x and pctAt(x, y, s) or 0 end
                want = chosen(a, pct)
            end
            setNutrients(p, want, bool(p, "bCanGiveNutrients"))
            if want then st.plantsNutri = st.plantsNutri + 1 end
            -- Fruit trees: fewer fruits outside the migration areas.
            if bool(p, "bIsStaticSpawner") then
                remember(orig.fruitsMin, a, num(p, "MinAmountOfFruits"))
                remember(orig.fruitsMax, a, num(p, "MaxAmountOfFruits"))
                local x, y = where(p)
                local inside = x and pctAt(x, y, s) > 0
                local k = (on and not inside) and s.outsideAmountPct / 100 or 1
                if orig.fruitsMin[a] then setInt(p, "MinAmountOfFruits", math.floor(orig.fruitsMin[a] * k + 0.5)) end
                if orig.fruitsMax[a] then setInt(p, "MaxAmountOfFruits", math.max(orig.fruitsMin[a] and math.floor(orig.fruitsMin[a] * k + 0.5) or 0, math.floor(orig.fruitsMax[a] * k + 0.5))) end
            end
        end
    end
    return st
end

local function controlFruits(s, on, st)
    local okA, all = pcall(function() return FindAllOf("TIFruitBase") or {} end)
    st.fruits, st.fruitsNutri = 0, 0
    for _, f in ipairs(okA and all or {}) do
        local a = H.isValid(f) and addressOf(f)
        if a then
            st.fruits = st.fruits + 1
            local want = true
            if on then local x, y = where(f); want = chosen(a, x and pctAt(x, y, s) or 0) end
            setNutrients(f, want, bool(f, "bCanGiveNutri"))
            if want then st.fruitsNutri = st.fruitsNutri + 1 end
        end
    end
end

local controlNext = 0
local function controlStep()
    if disabled then return end
    local s = readSettings()
    local on = s.control
    if not on and not applied then return end          -- off, and nothing of ours to put back
    local now = os.time() * 1000
    if controlStage == 0 then
        if now < controlNext then return end
        if controlFirst then markRunning(true, CONTROL_FLAG) end
        controlSpawners(s, on)
        controlStage = 1
    elseif controlStage == 1 then
        stats = controlPlants(s, on)
        controlStage = 2
    else
        controlFruits(s, on, stats)
        stats.on, stats.t, stats.active = on, os.time(), #activeRings
        controlStage = 0
        controlNext = now + CONTROL_MS
        if controlFirst then
            controlFirst = false
            markRunning(false, CONTROL_FLAG)
            H.log(string.format("%s: control %s — %d/%d plants and %d/%d fruits give nutrients, %d active areas", MOD,
                on and "on" or "off (game values put back)", stats.plantsNutri, stats.plants, stats.fruitsNutri, stats.fruits, #activeRings))
        end
        applied = on
    end
end

local crashed = io.open(FLAG, "r")
if crashed then
    crashed:close()
    disabled = true
    H.logError(MOD .. ": the last export did not finish (the server stopped during it) — exports are off. "
        .. "Delete " .. FLAG .. " to try again.")
else
    local controlCrashed = io.open(CONTROL_FLAG, "r")
    if controlCrashed then
        controlCrashed:close()
        H.logError(MOD .. ": the last control round did not finish (the server stopped during it) — control is off. "
            .. "Delete " .. CONTROL_FLAG .. " to try again.")
    else
        H.every(CONTROL_MS // 3, MOD .. " control", controlStep)
    end
    H.every(STEP_MS, MOD .. " export", step)
    LoopAsync(WRITE_MS, function() write(); return false end)
    H.log(MOD .. ": loaded — exporting plants every " .. (EXPORT_MS // 1000) .. " s to " .. OUT)
end
