-- Flora, the island's real plants, for the admin map (step 1: read-only).
--
-- What PlantProbe found (2026-09-26): plants are actors.
--   TIEdibleSpawner  (BP_EdiblePlantsSpawnable_C, ~80), an area (box, sphere
--                    or spline) that spawns edible plants; the migration and
--                    mass-migration zones are these (bShouldUseMigration,
--                    bBecameMassMigration, MigrationSpawnMultiplier…)
--   TIEdiblePlant    a plant (bushes, flowers, fruit trees): bCanGiveNutrients,
--                    Carb/Protein/LipidProportion, its Spawner
--   TIFruitBase      a fruit (mango, banana…): bCanGiveNutri
--
-- Step 2, control (off until the panel turns it on, settings.json from the
-- bridge): nutrient plants only where herbivores migrate.
--   * a plant / fruit gives nutrients only inside an ACTIVE migration area:
--     `migrationNutrientPct` of them there, `massNutrientPct` in a mass
--     migration, none outside (SetCanGiveNutrients, the game's own call;
--     which ones is fixed by each actor's address, so it does not flicker)
--   * how many grow: at most `migrationMaxPerArea` / `massMaxPerArea` /
--     `outsideMaxPerArea` plants in one area (the game's AmountToBeSpawned and
--     MinimumZoneAmountToBeSpawned lowered to it; the game put 40, even 70, in
--     a 25 m area), plus the game's MigrationSpawnMultiplier; plants above the
--     cap are removed with the game's own DestroyPlant, the ones without
--     nutrients first, TRIM_PER_ROUND a round; `outsideAmountPct` of the fruit
--     trees' fruit counts
--   * the game's own values are remembered and put back when it is turned off
--   * checked every CONTROL_MS (plants keep growing back), a round in small
--     pieces, CONTROL_CHUNK plants or fruits a tick (whole families in one
--     tick held the game thread 35 to 51 ms, 2026-10-08); numbers and
--     booleans only; a flag against a crash loop, as for exports
--
-- Every EXPORT_MS this writes Mods/Flora/Saved/flora.json: each spawner (where,
-- its shape, whether it is a migration zone and active / mass now) and every
-- plant and fruit (class, where, whether it gives nutrients, and its α/β/γ
-- proportions). The bridge serves it to the panel's map, and reads the
-- spawners for the prime zone tasks (zone-credit.ts), so they stay fresh.
-- The plants and fruits are for the map only: read every PLANTS_EVERY_MS,
-- CHUNK a tick (all ~1,200 plants in one tick held the game thread up to
-- 275 ms, 2026-09-27; 150 a tick still up to 39 ms, 2026-10-08); each
-- export carries the last complete read.
--
-- Read-only, and careful (lessons of 2026-09-24 and 2026-09-26):
--   * only numbers and booleans are read from these actors, plus the
--     components the game made for their shape (Box / Sphere / AreaSpline,
--     through their UFunctions) and the plant's Spawner, nothing else
--   * one piece per game-thread tick (the spawners, or CHUNK plants / fruits),
--     found fresh by FindAllOf in that tick; no actor kept across ticks (a
--     chunk goes on from an index; an actor seen twice, the list having moved,
--     is counted once by its address)
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
local EXPORT_MS = 120000     -- the spawners every two minutes…
local PLANTS_EVERY_MS = 600000   -- …the plants and fruits every ten…
local CHUNK = 75             -- …this many a tick (~20 ms; 150 took up to 39)
-- The panel's map "Tải lại" (bridge: POST /api/map/flora/refresh) leaves this
-- file: the plants are read again now, not at the next ten minutes; at most
-- once in REFRESH_GAP_S (a full read of ~1,600 is ~21 ticks, ~40 s).
local REFRESH = DIR .. "refresh.request"
local REFRESH_GAP_S = 30
local STEP_MS = 2000         -- ticks two seconds apart (a whole read in ~40 s, as with 150 a tick every 3 s)
local WRITE_MS = 5000
local SPLINE_POINTS = 64     -- at most, per spline area

local disabled = false
local firstDone = false
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

local function plantRow(p)
    local x, y = where(p)
    if not x then return nil end
    local spawner = nil
    pcall(function() local s = p.Spawner; if s ~= nil and H.isValid(s) then spawner = addressOf(s) end end)
    return {
        c = className(p), x = x, y = y, n = bool(p, "bCanGiveNutrients"), ft = num(p, "FoodType"),
        cp = r2(num(p, "CarbProportion")), pp = r2(num(p, "ProteinProportion")), lp = r2(num(p, "LipidProportion")),
        eaten = bool(p, "bWasConsumed"), s = spawner,
    }
end

local function fruitRow(f)
    local x, y = where(f)
    if not x then return nil end
    return {
        c = className(f), x = x, y = y, n = bool(f, "bCanGiveNutri"), ft = num(f, "GoreFoodType"),
        cp = r2(num(f, "CarbProportion")), pp = r2(num(f, "ProteinProportion")), lp = r2(num(f, "LipidProportion")),
    }
end

local FAMILIES = {
    plants = { cls = "TIEdiblePlant", row = plantRow, next = "fruits" },
    fruits = { cls = "TIFruitBase", row = fruitRow },
}

--- The next CHUNK of a family being read (b: { family, list, seen, from }). True once it is all read.
local function readChunk(b)
    local fam = FAMILIES[b.family]
    local okA, all = pcall(function() return FindAllOf(fam.cls) or {} end)
    all = okA and all or {}
    local last = math.min(#all, b.from + CHUNK - 1)
    for i = b.from, last do
        local o = all[i]
        if H.isValid(o) then
            local a = addressOf(o)
            if a and not b.seen[a] then
                b.seen[a] = true
                local row = fam.row(o)
                if row then b.list[#b.list + 1] = row end
            end
        end
    end
    b.from = last + 1
    return b.from > #all
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

-- One piece of work per tick: the spawners when they are due (each time an
-- export, with the last complete plants and fruits), else CHUNK plants or
-- fruits when those are being read.
local last = { plants = {}, fruits = {}, t = nil }
local reading = nil          -- { family, list, seen, from }
local nextAt, plantsAt = 0, 0

-- The flag is up only for the tick that first reads a kind of actor (the
-- spawners, the plants, the fruits): a stop between ticks, a restart,
-- never leaves it behind.
local tried = {}
local function guarded(kind, fn)
    local first = not tried[kind]
    if first then markRunning(true) end
    local ok, r = pcall(fn)   -- a Lua error is not a crash: the flag comes down all the same
    if first then tried[kind] = true; markRunning(false) end
    if not ok then error(r, 0) end
    return r
end

local function step()
    if disabled then return end
    local now = os.time() * 1000
    if now >= nextAt then
        ready = { t = os.time(), spawners = guarded("spawners", readSpawners), plants = last.plants,
            fruits = last.fruits, plantsT = last.t, control = stats }
        nextAt = now + EXPORT_MS
        return
    end
    if reading == nil then
        local asked = io.open(REFRESH, "r")
        if asked then
            asked:close()
            os.remove(REFRESH)
            if last.t == nil or os.time() - last.t >= REFRESH_GAP_S then
                plantsAt = 0
                H.log(MOD .. ": plants read again, asked from the panel")
            end
        end
        if now < plantsAt then return end
        reading = { family = "plants", list = {}, seen = {}, from = 1 }
    end
    local b = reading
    if not guarded(b.family, function() return readChunk(b) end) then return end
    last[reading.family] = reading.list
    local nextFamily = FAMILIES[reading.family].next
    if nextFamily then
        reading = { family = nextFamily, list = {}, seen = {}, from = 1 }
        return
    end
    reading = nil
    last.t = os.time()
    plantsAt = now + PLANTS_EVERY_MS
    nextAt = 0   -- an export now, with them
    if not firstDone then
        firstDone = true
        H.log(string.format("%s: first export, %d plants, %d fruits", MOD, #last.plants, #last.fruits))
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
               massNutrientPct = 100, massMultiplier = 3, outsideAmountPct = 30,
               migrationMaxPerArea = 15, massMaxPerArea = 40, outsideMaxPerArea = 3 }
local TRIM_PER_ROUND = 60
local TRIM_FLAG = DIR .. "trim.running"

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
        migrationMaxPerArea = clamp(d.migrationMaxPerArea, 1, 100, CDEF.migrationMaxPerArea),
        massMaxPerArea = clamp(d.massMaxPerArea, 1, 200, CDEF.massMaxPerArea),
        outsideMaxPerArea = clamp(d.outsideMaxPerArea, 0, 50, CDEF.outsideMaxPerArea),
    }
    return settings
end

-- The game's own values, first seen before we changed them (by address).
local orig = { multiplier = {}, amount = {}, minAmount = {}, fruitsMin = {}, fruitsMax = {} }
local zones = {}          -- spawner address -> { active, mass, ring } (this control round)
local activeRings = {}    -- rings of the active / mass areas, for fruits and plants without a spawner
local applied = false     -- the control has changed something that needs putting back
local controlFirst = true
local trimFirst = true       -- the first DestroyPlant round runs under its own crash flag

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

--- One spawning area: its migration state (for the plants and fruits after
--- it) and the game's numbers for it. `zones` / `activeRings` start empty
--- each round.
local function controlSpawner(r, sp, a)
    local s, on = r.s, r.on
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
        -- The most plants this area may hold now.
        z.cap = z.mass and s.massMaxPerArea or z.active and s.migrationMaxPerArea
            or (not z.migration) and s.outsideMaxPerArea or nil
        if z.cap ~= nil then
            if orig.amount[a] then setInt(sp, "AmountToBeSpawned", math.min(orig.amount[a], z.cap)) end
            if orig.minAmount[a] then setInt(sp, "MinimumZoneAmountToBeSpawned", math.min(orig.minAmount[a], z.cap)) end
        else
            if orig.amount[a] then setInt(sp, "AmountToBeSpawned", orig.amount[a]) end
            if orig.minAmount[a] then setInt(sp, "MinimumZoneAmountToBeSpawned", orig.minAmount[a]) end
        end
    else
        if orig.multiplier[a] then setInt(sp, "MigrationSpawnMultiplier", orig.multiplier[a]) end
        if orig.amount[a] then setInt(sp, "AmountToBeSpawned", orig.amount[a]) end
        if orig.minAmount[a] then setInt(sp, "MinimumZoneAmountToBeSpawned", orig.minAmount[a]) end
    end
end

-- A control round, one piece per CONTROL_TICK_MS tick (2026-10-08: the
-- plants, ~600, then the fruits, ~1,000, each in one tick held the game
-- thread 35 to 51 ms, more than a frame at 30 FPS, in most 5-minute
-- windows; the 80 spawners alone took 20 to 27 ms): SPAWNER_CHUNK spawners,
-- then CONTROL_CHUNK plants or fruits a tick, found fresh by FindAllOf each
-- tick and gone on from an index (an
-- actor seen twice, the list having moved, counted once by its address).
-- Plants over an area's cap are only noted (addresses, numbers), and removed
-- after the plants are all seen, at most TRIM_PER_TICK a tick, each found
-- again by its address and its area. The round's counts reach the export
-- when the round is complete.
local CONTROL_TICK_MS = 1000
local CONTROL_CHUNK = 150
local SPAWNER_CHUNK = 40
local TRIM_PER_TICK = 20

--- One plant: its nutrients and, for a fruit tree, its fruits. Notes it in
--- `r.byArea` when its area has a cap (to be trimmed after the last chunk).
local function controlPlant(r, p, a)
    local s, on, st = r.s, r.on, r.st
    st.plants = st.plants + 1
    local want, entry = true, nil
    if on then
        local zone, za = nil, nil
        pcall(function() local sp = p.Spawner; if sp ~= nil and H.isValid(sp) then za = addressOf(sp); zone = zones[za] end end)
        if zone ~= nil and zone.cap ~= nil and not bool(p, "bWasConsumed") then
            local list = r.byArea[za] or { cap = zone.cap }
            r.byArea[za] = list
            entry = { a = a }
            list[#list + 1] = entry
        end
        local pct
        if zone ~= nil then pct = pctFor(zone, s)
        else local x, y = where(p); pct = x and pctAt(x, y, s) or 0 end
        want = chosen(a, pct)
    end
    setNutrients(p, want, bool(p, "bCanGiveNutrients"))
    if want then st.plantsNutri = st.plantsNutri + 1 end
    if entry then entry.nutri = want end
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

local function controlFruit(r, f, a)
    local st = r.st
    st.fruits = st.fruits + 1
    local want = true
    if r.on then local x, y = where(f); want = chosen(a, x and pctAt(x, y, r.s) or 0) end
    setNutrients(f, want, bool(f, "bCanGiveNutri"))
    if want then st.fruitsNutri = st.fruitsNutri + 1 end
end

local CONTROL_FAMILIES = {
    spawners = { cls = "TIEdibleSpawner", fn = controlSpawner, chunk = SPAWNER_CHUNK },
    plants = { cls = "TIEdiblePlant", fn = controlPlant, chunk = CONTROL_CHUNK },
    fruits = { cls = "TIFruitBase", fn = controlFruit, chunk = CONTROL_CHUNK },
}

--- The next chunk of the round's family; true when the family is done.
local function controlChunk(r)
    local fam = CONTROL_FAMILIES[r.family]
    local okA, all = pcall(function() return FindAllOf(fam.cls) or {} end)
    all = okA and all or {}
    local done, i = 0, r.from
    while i <= #all and done < fam.chunk do
        local o = all[i]
        local a = H.isValid(o) and addressOf(o)
        if a and not r.seen[a] then
            r.seen[a] = true
            fam.fn(r, o, a)
            done = done + 1
        end
        i = i + 1
    end
    r.from = i
    return i > #all
end

--- The plants over their area's cap, without nutrients first, at most
--- TRIM_PER_ROUND: address -> its area's address.
local function trimList(byArea)
    local out, n = {}, 0
    for za, list in pairs(byArea) do
        local extra = #list - list.cap
        if extra > 0 and n < TRIM_PER_ROUND then
            table.sort(list, function(x, y) return (x.nutri and 1 or 0) < (y.nutri and 1 or 0) end)
            for k = 1, math.min(extra, TRIM_PER_ROUND - n) do out[list[k].a] = { area = za, nutri = list[k].nutri }; n = n + 1 end
        end
    end
    return out, n
end

--- Removes up to TRIM_PER_TICK of the noted plants, each found again by its
--- address, still in the same area and not eaten; true when none is left.
local function trimChunk(r)
    local okA, all = pcall(function() return FindAllOf("TIEdiblePlant") or {} end)
    local removed = 0
    for _, p in ipairs(okA and all or {}) do
        if removed >= TRIM_PER_TICK then break end
        local a = H.isValid(p) and addressOf(p)
        local t = a and r.trim[a]
        if t then
            r.trim[a], r.trimLeft = nil, r.trimLeft - 1
            local za = nil
            pcall(function() local sp = p.Spawner; if sp ~= nil and H.isValid(sp) then za = addressOf(sp) end end)
            if za == t.area and not bool(p, "bWasConsumed") then
                if trimFirst then markRunning(true, TRIM_FLAG) end
                if pcall(function() p:DestroyPlant() end) then
                    r.st.trimmed = r.st.trimmed + 1
                    if t.nutri then r.st.plantsNutri = r.st.plantsNutri - 1 end
                end
                if trimFirst then trimFirst = false; markRunning(false, TRIM_FLAG) end
                removed = removed + 1
            end
        end
    end
    -- Not found in a whole pass (eaten, despawned): no longer ours to remove.
    if removed < TRIM_PER_TICK then r.trim, r.trimLeft = {}, 0 end
    return r.trimLeft <= 0
end

local controlNext = 0
local round = nil          -- the round under way: { stage, s, on, st, family, from, seen, byArea, trim, trimLeft }
local function controlStep()
    if disabled then return end
    local now = os.time() * 1000
    if round == nil then
        if now < controlNext then return end
        local s = readSettings()
        if not s.control and not applied then return end      -- off, and nothing of ours to put back
        round = { stage = "family", family = "spawners", from = 1, seen = {}, s = s, on = s.control,
            st = { plants = 0, plantsNutri = 0, trimmed = 0, fruits = 0, fruitsNutri = 0 } }
        zones, activeRings = {}, {}
        if controlFirst then markRunning(true, CONTROL_FLAG) end
    end
    local r = round
    if r.stage == "family" then
        if not controlChunk(r) then return end
        if r.family == "spawners" then
            r.family, r.from, r.seen, r.byArea = "plants", 1, {}, {}
            return
        end
        if r.family == "plants" then
            r.trim, r.trimLeft = trimList(r.byArea)
            r.byArea = nil
            if r.trimLeft > 0 then r.stage = "trim" else r.family, r.from, r.seen = "fruits", 1, {} end
            return
        end
    elseif r.stage == "trim" then
        if trimChunk(r) then r.stage, r.family, r.from, r.seen = "family", "fruits", 1, {} end
        return
    end
    -- The fruits done: the round is complete.
    local st = r.st
    st.on, st.t, st.active = r.on, os.time(), #activeRings
    stats = st
    round = nil
    controlNext = now + CONTROL_MS
    if controlFirst then
        controlFirst = false
        markRunning(false, CONTROL_FLAG)
        H.log(string.format("%s: control %s, %d/%d plants and %d/%d fruits give nutrients, %d active areas", MOD,
            r.on and "on" or "off (game values put back)", st.plantsNutri, st.plants, st.fruitsNutri, st.fruits, #activeRings))
    end
    if st.trimmed > 0 then
        H.log(string.format("%s: %d plants over their area's cap removed (DestroyPlant)", MOD, st.trimmed))
    end
    applied = r.on
end

local crashed = io.open(FLAG, "r")
if crashed then
    crashed:close()
    disabled = true
    H.logError(MOD .. ": the last export did not finish (the server stopped during it), exports are off. "
        .. "Delete " .. FLAG .. " to try again.")
else
    local trimCrashed = io.open(TRIM_FLAG, "r")
    if trimCrashed then
        trimCrashed:close()
        TRIM_PER_ROUND = 0
        H.logError(MOD .. ": the last trim (DestroyPlant) did not finish, plants are no longer removed, only capped. "
            .. "Delete " .. TRIM_FLAG .. " to try again.")
    end
    local controlCrashed = io.open(CONTROL_FLAG, "r")
    if controlCrashed then
        controlCrashed:close()
        H.logError(MOD .. ": the last control round did not finish (the server stopped during it), control is off. "
            .. "Delete " .. CONTROL_FLAG .. " to try again.")
    else
        H.every(CONTROL_TICK_MS, MOD .. " control", controlStep)
    end
    H.every(STEP_MS, MOD .. " export", step)
    LoopAsync(WRITE_MS, function() write(); return false end)
    H.log(MOD .. ": loaded, spawners every " .. (EXPORT_MS // 1000) .. " s, plants every "
        .. (PLANTS_EVERY_MS // 1000) .. " s (" .. CHUNK .. " a tick) to " .. OUT)
end
