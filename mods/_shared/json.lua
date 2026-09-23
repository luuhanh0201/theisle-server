--[[
    _shared/json.lua

    Minimal JSON encode/decode for persisted mod state.

    Scope on purpose:
      * encode: nil/boolean/number/string/table (array or object)
      * decode: the full JSON grammar except \uXXXX surrogate pairs, which are
        decoded per-escape and may produce invalid UTF-8 for astral characters
      * no NaN / inf (encode raises — catch it with helpers.try)
      * key order is not stable; do not diff encoded output

    Both entry points raise on malformed input. Callers must pcall:
        local ok, data = pcall(json.decode, raw)
]]

local json = {}

--------------------------------------------------------------------------
-- Encode
--------------------------------------------------------------------------

local escapeMap = {
    ['"']  = '\\"',
    ['\\'] = '\\\\',
    ['\b'] = '\\b',
    ['\f'] = '\\f',
    ['\n'] = '\\n',
    ['\r'] = '\\r',
    ['\t'] = '\\t',
}

local function escapeChar(c)
    return escapeMap[c] or string.format('\\u%04x', string.byte(c))
end

local function encodeString(s)
    return '"' .. s:gsub('[%z\1-\31\\"]', escapeChar) .. '"'
end

local function encodeNumber(n)
    if n ~= n or n == math.huge or n == -math.huge then
        error("json: cannot encode " .. tostring(n))
    end
    if n == math.floor(n) and math.abs(n) < 1e15 then
        return string.format("%d", n)
    end
    return string.format("%.14g", n)
end

-- An empty table encodes as {}. A table with a 1..n integer run encodes as an
-- array; anything else as an object.
local function isArray(t)
    local n = 0
    for k in pairs(t) do
        if type(k) ~= "number" then return false end
        n = n + 1
    end
    for i = 1, n do
        if t[i] == nil then return false end
    end
    return n > 0
end

local encodeValue

local function encodeTable(t, seen)
    if seen[t] then error("json: circular reference") end
    seen[t] = true

    local out = {}
    if isArray(t) then
        for i = 1, #t do
            out[#out + 1] = encodeValue(t[i], seen)
        end
        seen[t] = nil
        return "[" .. table.concat(out, ",") .. "]"
    end

    for k, v in pairs(t) do
        if type(k) ~= "string" then
            error("json: object keys must be strings, got " .. type(k))
        end
        out[#out + 1] = encodeString(k) .. ":" .. encodeValue(v, seen)
    end
    seen[t] = nil
    return "{" .. table.concat(out, ",") .. "}"
end

encodeValue = function(v, seen)
    local t = type(v)
    if v == nil then return "null" end
    if t == "boolean" then return tostring(v) end
    if t == "number" then return encodeNumber(v) end
    if t == "string" then return encodeString(v) end
    if t == "table" then return encodeTable(v, seen) end
    error("json: cannot encode " .. t)
end

function json.encode(value)
    return encodeValue(value, {})
end

--------------------------------------------------------------------------
-- Decode
--------------------------------------------------------------------------

local function skipWhitespace(s, i)
    local _, j = s:find("^[ \t\r\n]*", i)
    return j + 1
end

local function decodeError(s, i, msg)
    error(string.format("json: %s at position %d", msg, i))
end

local unescapeMap = {
    ['"']  = '"',
    ['\\'] = '\\',
    ['/']  = '/',
    ['b']  = '\b',
    ['f']  = '\f',
    ['n']  = '\n',
    ['r']  = '\r',
    ['t']  = '\t',
}

local function codepointToUtf8(n)
    if n < 0x80 then
        return string.char(n)
    elseif n < 0x800 then
        return string.char(0xC0 + math.floor(n / 0x40),
                           0x80 + n % 0x40)
    elseif n < 0x10000 then
        return string.char(0xE0 + math.floor(n / 0x1000),
                           0x80 + math.floor(n / 0x40) % 0x40,
                           0x80 + n % 0x40)
    end
    return string.char(0xF0 + math.floor(n / 0x40000),
                       0x80 + math.floor(n / 0x1000) % 0x40,
                       0x80 + math.floor(n / 0x40) % 0x40,
                       0x80 + n % 0x40)
end

local function decodeString(s, i)
    -- s:sub(i) == '"...'
    local out = {}
    local j = i + 1
    while true do
        local c = s:sub(j, j)
        if c == "" then decodeError(s, j, "unterminated string") end
        if c == '"' then
            return table.concat(out), j + 1
        end
        if c == "\\" then
            local e = s:sub(j + 1, j + 1)
            if e == "u" then
                local hex = s:sub(j + 2, j + 5)
                local n = tonumber(hex, 16)
                if not n or #hex < 4 then decodeError(s, j, "bad \\u escape") end
                out[#out + 1] = codepointToUtf8(n)
                j = j + 6
            else
                local u = unescapeMap[e]
                if not u then decodeError(s, j, "bad escape \\" .. e) end
                out[#out + 1] = u
                j = j + 2
            end
        else
            out[#out + 1] = c
            j = j + 1
        end
    end
end

local function decodeNumber(s, i)
    local _, j = s:find("^-?%d+%.?%d*[eE]?[-+]?%d*", i)
    local n = tonumber(s:sub(i, j))
    if not n then decodeError(s, i, "bad number") end
    return n, j + 1
end

local decodeValue

local function decodeArray(s, i)
    local out, j = {}, skipWhitespace(s, i + 1)
    if s:sub(j, j) == "]" then return out, j + 1 end

    while true do
        local v
        v, j = decodeValue(s, j)
        out[#out + 1] = v
        j = skipWhitespace(s, j)

        local c = s:sub(j, j)
        if c == "]" then return out, j + 1 end
        if c ~= "," then decodeError(s, j, "expected ',' or ']'") end
        j = skipWhitespace(s, j + 1)
    end
end

local function decodeObject(s, i)
    local out, j = {}, skipWhitespace(s, i + 1)
    if s:sub(j, j) == "}" then return out, j + 1 end

    while true do
        if s:sub(j, j) ~= '"' then decodeError(s, j, "expected object key") end

        local k, v
        k, j = decodeString(s, j)
        j = skipWhitespace(s, j)
        if s:sub(j, j) ~= ":" then decodeError(s, j, "expected ':'") end

        j = skipWhitespace(s, j + 1)
        v, j = decodeValue(s, j)
        out[k] = v
        j = skipWhitespace(s, j)

        local c = s:sub(j, j)
        if c == "}" then return out, j + 1 end
        if c ~= "," then decodeError(s, j, "expected ',' or '}'") end
        j = skipWhitespace(s, j + 1)
    end
end

decodeValue = function(s, i)
    i = skipWhitespace(s, i)
    local c = s:sub(i, i)

    if c == '"' then return decodeString(s, i) end
    if c == "{" then return decodeObject(s, i) end
    if c == "[" then return decodeArray(s, i) end
    if c == "-" or c:match("%d") then return decodeNumber(s, i) end
    if s:sub(i, i + 3) == "true"  then return true, i + 4 end
    if s:sub(i, i + 4) == "false" then return false, i + 5 end
    if s:sub(i, i + 3) == "null"  then return nil, i + 4 end

    decodeError(s, i, "unexpected character '" .. c .. "'")
end

function json.decode(str)
    if type(str) ~= "string" then
        error("json: decode expects a string, got " .. type(str))
    end
    local value, i = decodeValue(str, 1)
    i = skipWhitespace(str, i)
    if i <= #str then
        decodeError(str, i, "trailing garbage")
    end
    return value
end

return json
