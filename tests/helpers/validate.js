// Tiny JSON-Schema-ish validator. Supports the subset we use across the
// framework: type, required, properties, items, enum, minimum, oneOf, $ref
// (local #/definitions/...), additionalProperties. Not a full JSON Schema
// engine — just enough to keep the spec and the engine honest.
import fs from 'node:fs';
import path from 'node:path';

export function loadJSON(relPath) {
  const abs = path.resolve(process.cwd(), relPath);
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref: ${ref}`);
  return ref
    .slice(2)
    .split('/')
    .reduce((node, key) => node[key], root);
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function check(node, schema, root, path, errors) {
  if (schema.$ref) {
    return check(node, resolveRef(root, schema.$ref), root, path, errors);
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((sub) => {
      const sub_errors = [];
      check(node, sub, root, path, sub_errors);
      return sub_errors.length === 0;
    });
    if (matches.length !== 1) {
      errors.push(`${path}: must match exactly one of oneOf (matched ${matches.length})`);
    }
    return;
  }
  if (schema.type) {
    const actual = typeOf(node);
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = expected.some((t) => {
      if (t === 'number') return actual === 'number' || actual === 'integer';
      return t === actual;
    });
    if (!ok) {
      errors.push(`${path}: expected type ${expected.join('|')}, got ${actual}`);
      return;
    }
  }
  if (schema.enum && !schema.enum.includes(node)) {
    errors.push(`${path}: ${JSON.stringify(node)} not in enum ${JSON.stringify(schema.enum)}`);
  }
  if (typeof schema.minimum === 'number' && typeof node === 'number' && node < schema.minimum) {
    errors.push(`${path}: ${node} < minimum ${schema.minimum}`);
  }
  if (schema.type === 'object' || schema.properties || schema.required) {
    if (typeOf(node) !== 'object') return; // already reported
    for (const req of schema.required || []) {
      if (!(req in node)) errors.push(`${path}: missing required property "${req}"`);
    }
    if (schema.properties) {
      for (const [k, sub] of Object.entries(schema.properties)) {
        if (k in node) check(node[k], sub, root, `${path}.${k}`, errors);
      }
      if (schema.additionalProperties === false) {
        const allowed = new Set(Object.keys(schema.properties));
        for (const k of Object.keys(node)) {
          if (!allowed.has(k)) errors.push(`${path}: unexpected property "${k}"`);
        }
      }
    }
  }
  if (schema.type === 'array' && Array.isArray(node) && schema.items) {
    node.forEach((item, i) => check(item, schema.items, root, `${path}[${i}]`, errors));
  }
}

export function validate(data, schema) {
  const errors = [];
  check(data, schema, schema, '$', errors);
  return errors;
}
