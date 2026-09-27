--[[
    DinoGarage/skin.lua

    A player's own skin from the web (portal → bridge → inbox "skin"): the
    colours, pattern, theme and variation written onto the dino they play now.

    The game keeps a dino's skin in pawn.CustomizerData (FCustomizerDataBase):
    bIsFemale, SkinVariation, PatternIndex, ThemeIndex, <Region>Color x10
    (FLinearColor, the game's LINEAR values), SkinCode. The property is
    replicated: written in place on the server, the change reaches every
    client, which re-colours the dino (OnRep_CustomizerData). Not through
    SetCustomizerData(struct): a struct passed BY VALUE from Lua is what
    crashed RequestRespawn (docs/garage.md) — only numbers are written here,
    field by field, the way the prime conditions are (restore.lua).

    Flag first, like every first-time engine write: Saved/skin-write.trying
    is written before the first write of a run and removed after it; found
    at load, skins are not written this run (a crash stays one crash).

    Game thread (the inbox poll).
]]

local H = require("shared.isle.helpers")

local S = {}

S.FLAG = "Mods/DinoGarage/Saved/skin-write.trying"
S.REGIONS = { "Body", "Flank", "Underbelly", "Markings", "MaleDisplay", "Detail1", "Eyes", "Teeth", "Mouth", "Claws" }

local writes = nil   -- nil = not tried this run, true = worked, false = off
do
    local f = io.open(S.FLAG, "r")
    if f then
        f:close()
        writes = false
        H.logError("skin: the last run stopped while writing a skin — skins are not written. Delete " .. S.FLAG .. " to try again.")
    end
end

--- A linear colour channel 0–1, or nil (out of range is refused, not clamped).
local function unit(v)
    v = tonumber(v)
    if v == nil or v ~= v or v < 0 or v > 1 then return nil end
    return v
end

--- Check a skin from the inbox: { colors = { Body = {r,g,b}, … }, pattern, theme, variation }.
--- Returns the clean skin, or nil and why.
function S.validate(skin)
    if type(skin) ~= "table" or type(skin.colors) ~= "table" then return nil, "no colours" end
    local out = { colors = {} }
    for _, region in ipairs(S.REGIONS) do
        local c = skin.colors[region]
        if c ~= nil then
            local r, g, b = unit(type(c) == "table" and c.r), unit(type(c) == "table" and c.g), unit(type(c) == "table" and c.b)
            if r == nil or g == nil or b == nil then return nil, "bad colour " .. region end
            out.colors[region] = { r = r, g = g, b = b }
        end
    end
    if next(out.colors) == nil then return nil, "no colours" end
    for _, k in ipairs({ "pattern", "theme" }) do
        if skin[k] ~= nil then
            local n = tonumber(skin[k])
            if n == nil or n ~= math.floor(n) or n < 0 or n > 20 then return nil, "bad " .. k end
            out[k] = n
        end
    end
    if skin.variation ~= nil then
        local v = tonumber(skin.variation)
        if v == nil or v < 0 or v > 100 then return nil, "bad variation" end
        out.variation = v
    end
    return out
end

--- Write a checked skin onto a live pawn. Returns how many fields were written, or nil and why.
function S.apply(pawn, skin)
    if writes == false then return nil, "off" end
    if not H.isValid(pawn) then return nil, "no dino" end
    local okD, data = pcall(function() return pawn.CustomizerData end)
    if not okD or data == nil then return nil, "no CustomizerData" end

    local first = writes == nil
    if first then
        local f = io.open(S.FLAG, "w")
        if f then f:write(tostring(os.time())); f:close() end
    end
    local wrote = 0
    for region, c in pairs(skin.colors) do
        local okC, col = pcall(function() return data[region .. "Color"] end)
        if okC and col ~= nil then
            local ok = pcall(function() col.R = c.r; col.G = c.g; col.B = c.b end)
            if ok then wrote = wrote + 1 end
        end
    end
    if skin.pattern ~= nil and pcall(function() data.PatternIndex = skin.pattern end) then wrote = wrote + 1 end
    if skin.theme ~= nil and pcall(function() data.ThemeIndex = skin.theme end) then wrote = wrote + 1 end
    if skin.variation ~= nil and pcall(function() data.SkinVariation = skin.variation end) then wrote = wrote + 1 end
    if first then
        os.remove(S.FLAG)
        writes = true
    end
    H.log(string.format("skin: %d fields written", wrote))
    return wrote
end

return S
