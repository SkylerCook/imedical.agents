#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SCHEMA_VERSION = "2.0";
const MANIFEST_NAME = "00-run-manifest.json";
const EVENT_NAME = "events.jsonl";
const LEGACY_SCHEMAS = new Set(["1.0", "1.1", "1.2"]);
const MUTATING_COMMANDS = new Set(["init", "next", "ack", "message", "transition"]);
const TERMINAL_WORK = new Set(["completed", "failed", "skipped"]);
const AUTHORIZATION_KEYS = ["collaborationPlan", "remoteWrite", "commit", "merge", "push", "deploy", "feedbackWrite"];
const TASK_KINDS = new Set(["business-demand", "framework-maintenance", "other"]);

function fail(message, code = 1) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) fail(`Unexpected argument: ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) options[key] = true;
    else {
      options[key] = next;
      index += 1;
    }
  }
  return { command, options };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function now() {
  return new Date().toISOString();
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`Cannot read JSON ${file}: ${error.message}`);
  }
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

function requireRunDirectory(options) {
  const value = options.runDirectory || options.runDir;
  if (!value) fail("--run-directory is required");
  return path.resolve(value);
}

function manifestPath(runDirectory) {
  return path.join(runDirectory, MANIFEST_NAME);
}

function readManifestRaw(runDirectory) {
  const file = manifestPath(runDirectory);
  if (!fs.existsSync(file)) fail(`Run manifest not found: ${file}`);
  return readJson(file);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function buildPatches(before, after, pointer = "") {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (!before || !after || typeof before !== "object" || typeof after !== "object" || Array.isArray(before) !== Array.isArray(after)) {
    return [{ op: "set", path: pointer, value: clone(after) }];
  }
  if (Array.isArray(after)) {
    const patches = [];
    const shared = Math.min(before.length, after.length);
    for (let index = 0; index < shared; index += 1) patches.push(...buildPatches(before[index], after[index], `${pointer}/${index}`));
    for (let index = shared; index < after.length; index += 1) patches.push({ op: "set", path: `${pointer}/${index}`, value: clone(after[index]) });
    if (after.length < before.length) patches.push({ op: "set", path: pointer, value: clone(after) });
    return patches;
  }
  const patches = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const escaped = key.replace(/~/g, "~0").replace(/\//g, "~1");
    if (!Object.hasOwn(after, key)) patches.push({ op: "delete", path: `${pointer}/${escaped}` });
    else patches.push(...buildPatches(before[key], after[key], `${pointer}/${escaped}`));
  }
  return patches;
}

function applyPatches(document, patches) {
  let result = clone(document);
  for (const patch of patches || []) {
    if (patch.path === "") {
      result = patch.op === "delete" ? undefined : clone(patch.value);
      continue;
    }
    const segments = patch.path.slice(1).split("/").map((item) => item.replace(/~1/g, "/").replace(/~0/g, "~"));
    let target = result;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = Array.isArray(target) ? Number(segments[index]) : segments[index];
      if (target[segment] === undefined) target[segment] = /^\d+$/.test(segments[index + 1]) ? [] : {};
      target = target[segment];
    }
    const final = Array.isArray(target) ? Number(segments.at(-1)) : segments.at(-1);
    if (patch.op === "delete") {
      if (Array.isArray(target)) target.splice(final, 1);
      else delete target[final];
    } else target[final] = clone(patch.value);
  }
  return result;
}

function replayProjection(runDirectory) {
  const file = path.join(runDirectory, EVENT_NAME);
  if (!fs.existsSync(file)) return { manifest: null, issues: ["events.jsonl is missing"] };
  let projection;
  const issues = [];
  let expected = 1;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean)) {
    try {
      const event = JSON.parse(line);
      if (event.sequence !== expected) issues.push(`event sequence expected ${expected}, got ${event.sequence}`);
      projection = applyPatches(projection, event.payload?.projectionPatches || []);
    } catch (error) { issues.push(`invalid event JSON at sequence ${expected}: ${error.message}`); }
    expected += 1;
  }
  return { manifest: projection, issues };
}

function loadManifest(runDirectory, repair = false) {
  const raw = readManifestRaw(runDirectory);
  if (String(raw.schemaVersion) !== SCHEMA_VERSION) return raw;
  const replay = replayProjection(runDirectory);
  if (replay.issues.length || !replay.manifest) return raw;
  if (projectionHash(raw) !== projectionHash(replay.manifest) || raw.eventLog.lastSequence !== replay.manifest.eventLog.lastSequence) {
    if (repair) writeJsonAtomic(manifestPath(runDirectory), replay.manifest);
    return replay.manifest;
  }
  return raw;
}

function assertMutable(manifest, command) {
  if (LEGACY_SCHEMAS.has(String(manifest.schemaVersion))) {
    fail(`schema ${manifest.schemaVersion} is legacy-read-only; '${command}' is not allowed`);
  }
  if (String(manifest.schemaVersion) !== SCHEMA_VERSION) fail(`Unsupported schemaVersion: ${manifest.schemaVersion}`);
}

function withLock(runDirectory, callback) {
  const lock = path.join(runDirectory, "run.lock");
  let descriptor;
  try {
    descriptor = fs.openSync(lock, "wx");
    fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, createdAt: now() }));
  } catch (error) {
    fail(`Coordinator state is locked: ${lock}`);
  }
  try {
    return callback();
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(lock)) fs.unlinkSync(lock);
  }
}

function eventPayload(manifest, type, actorId, entityId, payload, idempotencyKey) {
  return {
    sequence: manifest.eventLog.lastSequence + 1,
    eventId: `evt-${crypto.randomUUID()}`,
    at: now(),
    actorId,
    type,
    entityId: entityId || null,
    idempotencyKey: idempotencyKey || null,
    payload: payload || {}
  };
}

function persist(runDirectory, manifest, type, actorId, entityId, payload, idempotencyKey) {
  const previous = fs.existsSync(manifestPath(runDirectory)) ? readManifestRaw(runDirectory) : undefined;
  const event = eventPayload(manifest, type, actorId, entityId, payload, idempotencyKey);
  manifest.eventLog.lastSequence = event.sequence;
  manifest.updatedAt = event.at;
  manifest.eventLog.projectionHash = "";
  manifest.eventLog.projectionHash = projectionHash(manifest);
  event.payload.projectionPatches = buildPatches(previous, manifest);
  fs.appendFileSync(path.join(runDirectory, EVENT_NAME), `${JSON.stringify(event)}\n`, "utf8");
  writeJsonAtomic(manifestPath(runDirectory), manifest);
  return event;
}

function projectionHash(manifest) {
  const clone = JSON.parse(JSON.stringify(manifest));
  if (clone.eventLog) clone.eventLog.projectionHash = "";
  return hash(clone);
}

function authorizationDefaults() {
  return Object.fromEntries(AUTHORIZATION_KEYS.map((key) => [key, {
    state: "not-granted", scopeHash: null, grantedAt: null, grantedBy: null
  }]));
}

function normalizeParticipant(value, index) {
  const id = value.id || `participant-${index + 1}`;
  return {
    id,
    role: value.role || "worker",
    endpoint: value.endpoint || { type: "serial", id: null },
    capabilities: value.capabilities || [],
    worktree: value.worktree || { mode: "none", ref: null },
    readScopes: value.readScopes || [],
    writeScopes: value.writeScopes || [],
    status: value.status || "available"
  };
}

function normalizeWorkItem(value, index, coordinatorId) {
  return {
    id: value.id || `work-${index + 1}`,
    title: value.title || value.id || `Work ${index + 1}`,
    kind: value.kind || "change",
    dependsOn: value.dependsOn || [],
    ownerId: value.ownerId || coordinatorId,
    status: value.status || "pending",
    readScopes: value.readScopes || [],
    writeScopes: value.writeScopes || [],
    maxAttempts: Number(value.maxAttempts || 1),
    attempts: value.attempts || [],
    inputRefs: value.inputRefs || [],
    outputRefs: value.outputRefs || [],
    completionCriteria: value.completionCriteria || [],
    authorizationCategory: value.authorizationCategory || null
  };
}

function taskLifecycle(taskKind) {
  return {
    acceptance: taskKind === "business-demand"
      ? { status: "implementing", evidenceRef: null, acceptedAt: null, acceptedBy: null }
      : { status: "not-applicable", evidenceRef: null, acceptedAt: null, acceptedBy: null },
    maintenance: taskKind === "framework-maintenance"
      ? { status: "maintaining", evidenceRefs: [], completedAt: null, completedBy: null }
      : { status: "not-applicable", evidenceRefs: [], completedAt: null, completedBy: null },
    feedbackDecision: {
      applicable: taskKind === "business-demand",
      applicabilityReason: taskKind,
      reviewState: "not-eligible",
      candidatesRef: null,
      decisions: []
    }
  };
}

function resetTaskLifecycle(manifest) {
  const lifecycle = taskLifecycle(manifest.taskKind);
  manifest.acceptance = lifecycle.acceptance;
  manifest.maintenance = lifecycle.maintenance;
  manifest.feedbackDecision = lifecycle.feedbackDecision;
}

function planMaterial(manifest) {
  return {
    taskKind: manifest.taskKind,
    workflow: manifest.workflow,
    orchestrationMode: manifest.orchestration.mode,
    adapter: manifest.orchestration.adapter,
    feedbackReviewApplicable: manifest.feedbackDecision.applicable,
    feedbackApplicabilityReason: manifest.feedbackDecision.applicabilityReason,
    participants: manifest.participants.map(({ id, role, endpoint, worktree, readScopes, writeScopes }) => ({ id, role, endpoint, worktree, readScopes, writeScopes })),
    workItems: manifest.workItems.map(({ id, dependsOn, ownerId, readScopes, writeScopes, completionCriteria, authorizationCategory }) => ({ id, dependsOn, ownerId, readScopes, writeScopes, completionCriteria, authorizationCategory }))
  };
}

function createManifest(options) {
  if (!options.plan) fail("init requires --plan <json>");
  const plan = readJson(path.resolve(options.plan));
  const createdAt = now();
  const coordinatorId = plan.coordinatorId || "coordinator";
  const taskKind = plan.taskKind || "other";
  if (!TASK_KINDS.has(taskKind)) fail(`Invalid taskKind: ${taskKind}`);
  const expectedFeedbackApplicability = taskKind === "business-demand";
  if (Object.hasOwn(plan, "feedbackReviewApplicable") && plan.feedbackReviewApplicable !== expectedFeedbackApplicability) {
    fail(`feedbackReviewApplicable must be ${expectedFeedbackApplicability} for taskKind ${taskKind}`);
  }
  if (plan.feedbackApplicabilityReason && plan.feedbackApplicabilityReason !== taskKind) {
    fail(`feedbackApplicabilityReason must match taskKind ${taskKind}`);
  }
  const lifecycle = taskLifecycle(taskKind);
  const participants = (plan.participants || [{ id: coordinatorId, role: "coordinator", endpoint: { type: "serial" } }]).map(normalizeParticipant);
  if (!participants.some((item) => item.id === coordinatorId)) {
    participants.unshift(normalizeParticipant({ id: coordinatorId, role: "coordinator", endpoint: { type: "serial" } }, -1));
  }
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    runId: options.runId || plan.runId || path.basename(path.resolve(options.runDirectory || options.runDir)),
    topic: options.topic || plan.topic || "",
    taskKind,
    workflow: { id: options.workflow || plan.workflow || "standard-change", source: plan.workflowSource || `workflows/${options.workflow || plan.workflow || "standard-change"}.workflow.md` },
    executionPath: options.executionPath || plan.executionPath || "full",
    orchestration: {
      mode: options.orchestrationMode || plan.orchestrationMode || "serial",
      adapter: options.adapter || plan.adapter || "serial",
      fallbacks: plan.fallbacks || ["serial", "human"],
      adapterCapabilities: plan.adapterCapabilities || { serial: true, human: true },
      validationSample: Boolean(plan.validationSample),
      planHash: ""
    },
    status: "planned",
    coordinatorId,
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    participants,
    workItems: (plan.workItems || []).map((item, index) => normalizeWorkItem(item, index, coordinatorId)),
    actions: [],
    messages: [],
    authorizations: { ...authorizationDefaults(), ...(plan.authorizations || {}) },
    acceptance: lifecycle.acceptance,
    maintenance: lifecycle.maintenance,
    feedbackDecision: lifecycle.feedbackDecision,
    verification: { status: "not-run", verifierId: null, scopes: [], lastMutationSequence: 0, verifiedThroughSequence: 0, revision: null },
    eventLog: { path: EVENT_NAME, lastSequence: 0, projectionHash: "" }
  };
  manifest.orchestration.planHash = hash(planMaterial(manifest));
  if (manifest.orchestration.mode === "multi-session") manifest.status = "awaiting-authorization";
  return manifest;
}

function dependenciesComplete(item, workMap) {
  return item.dependsOn.every((id) => workMap.get(id)?.status === "completed");
}

function selectAdapter(manifest) {
  const candidates = [manifest.orchestration.adapter, ...manifest.orchestration.fallbacks];
  return candidates.find((name) => manifest.orchestration.adapterCapabilities[name]) || null;
}

function actionType(adapter) {
  return ({ serial: "run-serial", subagent: "spawn-subagent", "codex-session": "create-session", human: "request-human" })[adapter] || "request-human";
}

function createAction(manifest, workItem, adapter, typeOverride, authorizationCategory) {
  const targetId = workItem?.ownerId || manifest.coordinatorId;
  const type = typeOverride || actionType(adapter);
  const participant = manifest.participants.find((item) => item.id === targetId);
  const previousFailures = workItem ? manifest.actions.filter((item) => item.workItemId === workItem.id && item.status === "failed").length : 0;
  const material = { runId: manifest.runId, workItemId: workItem?.id || null, adapter, targetId, type, planHash: manifest.orchestration.planHash, attempt: previousFailures + 1 };
  const idempotencyKey = hash(material);
  const existing = manifest.actions.find((item) => item.idempotencyKey === idempotencyKey && !["failed", "cancelled"].includes(item.status));
  if (existing) return existing;
  const action = {
    id: `act-${idempotencyKey.slice(0, 16)}`,
    workItemId: workItem?.id || null,
    type,
    title: type === "create-session" && workItem
      ? `${manifest.topic || manifest.runId} · ${participant?.role || targetId} · ${workItem.title}`
      : null,
    targetId,
    adapter,
    status: "pending",
    idempotencyKey,
    authorizationCategory: authorizationCategory || null,
    scopeHash: manifest.orchestration.planHash,
    payloadRef: workItem ? `#workItems/${workItem.id}` : null,
    result: null,
    createdAt: now()
  };
  manifest.actions.push(action);
  return action;
}

function commandInit(options) {
  const runDirectory = requireRunDirectory(options);
  if (fs.existsSync(manifestPath(runDirectory))) fail(`Run already exists: ${runDirectory}`);
  fs.mkdirSync(path.join(runDirectory, "messages"), { recursive: true });
  fs.mkdirSync(path.join(runDirectory, "handoffs"), { recursive: true });
  fs.writeFileSync(path.join(runDirectory, EVENT_NAME), "", "utf8");
  const manifest = createManifest({ ...options, runDirectory });
  const issues = validateV2(manifest, runDirectory, false, { skipProjection: true });
  if (issues.length) fail(`Invalid run plan:\n- ${issues.join("\n- ")}`);
  persist(runDirectory, manifest, "run.initialized", manifest.coordinatorId, manifest.runId, { planHash: manifest.orchestration.planHash });
  return manifest;
}

function commandNext(options) {
  const runDirectory = requireRunDirectory(options);
  return withLock(runDirectory, () => {
    const manifest = loadManifest(runDirectory, true);
    assertMutable(manifest, "next");
    const created = [];
    const grant = manifest.authorizations.collaborationPlan;
    if (manifest.orchestration.mode === "multi-session" && (grant.state !== "granted" || grant.scopeHash !== manifest.orchestration.planHash)) {
      const action = createAction(manifest, null, "human", "request-authorization", "collaborationPlan");
      created.push(action);
      manifest.status = "awaiting-authorization";
      persist(runDirectory, manifest, "actions.generated", manifest.coordinatorId, manifest.runId, { actionIds: created.map((item) => item.id) });
      return created;
    }
    const adapter = selectAdapter(manifest);
    if (!adapter) {
      manifest.status = "blocked";
      const action = createAction(manifest, null, "human", "request-human", null);
      created.push(action);
      persist(runDirectory, manifest, "run.blocked", manifest.coordinatorId, manifest.runId, { reason: "no-adapter", actionIds: [action.id] });
      return created;
    }
    const workMap = new Map(manifest.workItems.map((item) => [item.id, item]));
    for (const item of manifest.workItems) {
      if ((item.status === "pending" || item.status === "ready") && dependenciesComplete(item, workMap)) {
        item.status = "ready";
        const requiredAuthorization = item.authorizationCategory;
        const grant = requiredAuthorization ? manifest.authorizations[requiredAuthorization] : null;
        const authorized = !requiredAuthorization || (grant?.state === "granted" && grant.scopeHash === manifest.orchestration.planHash);
        const action = authorized
          ? createAction(manifest, item, adapter, null, requiredAuthorization)
          : createAction(manifest, item, "human", "request-authorization", requiredAuthorization);
        created.push(action);
      }
    }
    const allWorkTerminal = manifest.workItems.length > 0 && manifest.workItems.every((item) => TERMINAL_WORK.has(item.status));
    const writableOwners = manifest.participants.filter((item) => (item.writeScopes || []).length > 0);
    if (allWorkTerminal && manifest.orchestration.mode === "multi-session" && writableOwners.length > 1) {
      const integrationWork = { id: "integration-plan", ownerId: manifest.coordinatorId };
      const integration = createAction(manifest, integrationWork, "human", "prepare-integration", "merge");
      integration.payloadRef = "#authorizations/merge";
      created.push(integration);
      manifest.status = "awaiting-integration-authorization";
    }
    const unfinished = manifest.workItems.filter((item) => !TERMINAL_WORK.has(item.status));
    if (created.length === 0 && unfinished.length > 0 && !manifest.actions.some((item) => item.status === "pending")) manifest.status = "blocked";
    else if (created.length > 0 && manifest.status !== "awaiting-integration-authorization") manifest.status = "active";
    persist(runDirectory, manifest, "actions.generated", manifest.coordinatorId, manifest.runId, { actionIds: created.map((item) => item.id), adapter });
    return created;
  });
}

function commandAck(options) {
  const runDirectory = requireRunDirectory(options);
  if (!options.result) fail("ack requires --result <json>");
  const result = readJson(path.resolve(options.result));
  return withLock(runDirectory, () => {
    const manifest = loadManifest(runDirectory, true);
    assertMutable(manifest, "ack");
    const actionId = options.action || result.actionId;
    const action = manifest.actions.find((item) => item.id === actionId);
    if (!action) fail(`Unknown action: ${actionId}`);
    const normalized = { actionId, status: result.status, endpointId: result.endpointId || null, artifactRefs: result.artifactRefs || [], error: result.error || null };
    if (action.result) {
      if (hash(action.result) === hash(normalized)) return action;
      fail(`Conflicting ACK for action ${actionId}`);
    }
    if (!["succeeded", "failed", "blocked"].includes(normalized.status)) fail(`Invalid ACK status: ${normalized.status}`);
    action.result = normalized;
    action.status = normalized.status === "succeeded" ? "acknowledged" : normalized.status;
    const work = manifest.workItems.find((item) => item.id === action.workItemId);
    if (work) {
      work.attempts.push({ actionId, status: normalized.status, at: now(), artifactRefs: normalized.artifactRefs, error: normalized.error });
      if (normalized.status === "succeeded") {
        work.status = "completed";
        work.outputRefs = [...new Set([...work.outputRefs, ...normalized.artifactRefs])];
        if (work.writeScopes.length) {
          if (manifest.taskKind === "business-demand") {
            manifest.acceptance = taskLifecycle(manifest.taskKind).acceptance;
          } else if (manifest.taskKind === "framework-maintenance") {
            manifest.maintenance = taskLifecycle(manifest.taskKind).maintenance;
          }
          manifest.feedbackDecision.reviewState = "not-eligible";
          manifest.feedbackDecision.candidatesRef = null;
          manifest.feedbackDecision.decisions = [];
          manifest.verification.status = "stale";
          manifest.verification.lastMutationSequence = manifest.eventLog.lastSequence + 1;
        }
      } else if (work.attempts.length < work.maxAttempts) work.status = "pending";
      else work.status = normalized.status;
    }
    if (action.type === "deliver-message" && normalized.status === "succeeded") {
      const message = manifest.messages.find((item) => item.bodyRef === action.payloadRef && item.to.includes(action.targetId));
      if (message) {
        message.status = "delivered";
        message.deliveredAt = now();
      }
    }
    persist(runDirectory, manifest, "action.acknowledged", manifest.coordinatorId, action.id, normalized, action.idempotencyKey);
    return action;
  });
}

function safeMessageName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, "-");
}

function commandMessage(options) {
  const runDirectory = requireRunDirectory(options);
  if (!options.from || !options.to || !options.type) fail("message requires --from, --to and --type");
  if (!options.body && !options.bodyFile) fail("message requires --body or --body-file");
  return withLock(runDirectory, () => {
    const manifest = loadManifest(runDirectory, true);
    assertMutable(manifest, "message");
    const body = options.bodyFile ? fs.readFileSync(path.resolve(options.bodyFile), "utf8") : String(options.body);
    const messageId = `msg-${crypto.randomUUID()}`;
    const extension = options.type === "handoff" ? "handoffs" : "messages";
    const relative = `${extension}/${safeMessageName(messageId)}.md`;
    fs.writeFileSync(path.join(runDirectory, relative), body, "utf8");
    const message = { id: messageId, from: options.from, to: String(options.to).split(",").map((item) => item.trim()).filter(Boolean), type: options.type, bodyRef: relative.replace(/\\/g, "/"), status: "pending", createdAt: now(), deliveredAt: null, ackedAt: null };
    manifest.messages.push(message);
    for (const recipient of message.to) {
      const participant = manifest.participants.find((item) => item.id === recipient);
      const adapter = participant?.endpoint?.type || "human";
      const idempotencyKey = hash({ runId: manifest.runId, messageId, recipient, adapter });
      manifest.actions.push({
        id: `act-${idempotencyKey.slice(0, 16)}`,
        workItemId: null,
        type: "deliver-message",
        targetId: recipient,
        adapter,
        status: "pending",
        idempotencyKey,
        authorizationCategory: null,
        scopeHash: manifest.orchestration.planHash,
        payloadRef: message.bodyRef,
        result: null,
        createdAt: now()
      });
    }
    persist(runDirectory, manifest, "message.recorded", manifest.coordinatorId, messageId, { from: message.from, to: message.to, type: message.type, bodyRef: message.bodyRef });
    return message;
  });
}

const TRANSITIONS = {
  acceptance: {
    implementing: ["locally-verified"],
    "locally-verified": ["implementing", "acceptance-pending"],
    "acceptance-pending": ["implementing", "accepted"],
    accepted: ["implementing"]
  },
  maintenance: {
    maintaining: ["locally-verified"],
    "locally-verified": ["maintaining", "maintenance-complete"],
    "maintenance-complete": ["maintaining"]
  }
};

function commandTransition(options) {
  const runDirectory = requireRunDirectory(options);
  const entity = options.entity;
  const status = options.status;
  if (!entity || !status) fail("transition requires --entity and --status");
  return withLock(runDirectory, () => {
    const manifest = loadManifest(runDirectory, true);
    assertMutable(manifest, "transition");
    if (entity === "authorization") {
      const key = options.key;
      if (!AUTHORIZATION_KEYS.includes(key)) fail(`Unknown authorization: ${key}`);
      if (!["granted", "not-granted", "revoked"].includes(status)) fail(`Invalid authorization state: ${status}`);
      if (key === "feedbackWrite" && status === "granted" && manifest.taskKind !== "business-demand") fail("feedbackWrite is only available for business-demand tasks");
      if (key === "feedbackWrite" && status === "granted" && !manifest.feedbackDecision.applicable) fail("feedbackWrite cannot be granted when feedback review is not applicable");
      if (key === "feedbackWrite" && status === "granted" && manifest.acceptance.status !== "accepted") fail("feedbackWrite cannot be granted before accepted");
      manifest.authorizations[key] = {
        state: status,
        scopeHash: status === "granted" ? (options.scopeHash || manifest.orchestration.planHash) : null,
        grantedAt: status === "granted" ? now() : null,
        grantedBy: status === "granted" ? (options.actor || "user") : null
      };
      if (key === "collaborationPlan" && status === "granted") manifest.status = "planned";
    } else if (entity === "plan") {
      if (!options.patchFile) fail("plan transition requires --patch-file");
      const patch = readJson(path.resolve(options.patchFile));
      if (patch.taskKind && !TASK_KINDS.has(patch.taskKind)) fail(`Invalid taskKind: ${patch.taskKind}`);
      const nextTaskKind = patch.taskKind || manifest.taskKind;
      const expectedFeedbackApplicability = nextTaskKind === "business-demand";
      if (Object.hasOwn(patch, "feedbackReviewApplicable") && patch.feedbackReviewApplicable !== expectedFeedbackApplicability) {
        fail(`feedbackReviewApplicable must be ${expectedFeedbackApplicability} for taskKind ${nextTaskKind}`);
      }
      if (patch.feedbackApplicabilityReason && patch.feedbackApplicabilityReason !== nextTaskKind) {
        fail(`feedbackApplicabilityReason must match taskKind ${nextTaskKind}`);
      }
      manifest.taskKind = nextTaskKind;
      if (patch.participants) manifest.participants = patch.participants.map(normalizeParticipant);
      if (patch.workItems) manifest.workItems = patch.workItems.map((item, index) => normalizeWorkItem(item, index, manifest.coordinatorId));
      if (patch.orchestrationMode) manifest.orchestration.mode = patch.orchestrationMode;
      if (patch.adapter) manifest.orchestration.adapter = patch.adapter;
      resetTaskLifecycle(manifest);
      manifest.orchestration.planHash = hash(planMaterial(manifest));
      manifest.authorizations.collaborationPlan = { state: "revoked", scopeHash: null, grantedAt: null, grantedBy: null };
      manifest.verification.status = "stale";
      manifest.verification.lastMutationSequence = manifest.eventLog.lastSequence + 1;
      manifest.status = manifest.orchestration.mode === "multi-session" ? "awaiting-authorization" : "planned";
    } else if (entity === "acceptance") {
      if (manifest.taskKind !== "business-demand") fail("acceptance transitions are only available for business-demand tasks");
      const current = manifest.acceptance.status;
      if (!(TRANSITIONS.acceptance[current] || []).includes(status)) fail(`Invalid acceptance transition: ${current} -> ${status}`);
      if (status === "accepted" && options.actor !== "user") fail("accepted requires --actor user");
      if (status === "accepted" && !options.evidenceRef) fail("accepted requires --evidence-ref");
      manifest.acceptance.status = status;
      manifest.acceptance.evidenceRef = options.evidenceRef || null;
      manifest.acceptance.acceptedAt = status === "accepted" ? now() : null;
      manifest.acceptance.acceptedBy = status === "accepted" ? "user" : null;
      if (status !== "accepted") {
        manifest.feedbackDecision.reviewState = "not-eligible";
        manifest.feedbackDecision.candidatesRef = null;
        manifest.feedbackDecision.decisions = [];
      }
      if (status === "accepted" && manifest.feedbackDecision.applicable) manifest.feedbackDecision.reviewState = "pending";
      if (status === "accepted" && !manifest.feedbackDecision.applicable) manifest.feedbackDecision.reviewState = "not-eligible";
    } else if (entity === "maintenance") {
      if (manifest.taskKind !== "framework-maintenance") fail("maintenance transitions are only available for framework-maintenance tasks");
      const current = manifest.maintenance.status;
      if (!(TRANSITIONS.maintenance[current] || []).includes(status)) fail(`Invalid maintenance transition: ${current} -> ${status}`);
      if (["locally-verified", "maintenance-complete"].includes(status) && !options.evidenceRef) fail(`${status} requires --evidence-ref`);
      manifest.maintenance.status = status;
      if (options.evidenceRef) manifest.maintenance.evidenceRefs = [...new Set([...manifest.maintenance.evidenceRefs, options.evidenceRef])];
      manifest.maintenance.completedAt = status === "maintenance-complete" ? now() : null;
      manifest.maintenance.completedBy = status === "maintenance-complete" ? (options.actor || manifest.coordinatorId) : null;
    } else if (entity === "feedback-decision") {
      if (manifest.taskKind !== "business-demand") fail("Feedback review is only available for business-demand tasks");
      if (!manifest.feedbackDecision.applicable) fail("Feedback review is not applicable to this task");
      if (manifest.acceptance.status !== "accepted") fail("Feedback review is not eligible before accepted");
      if (!["pending", "completed"].includes(status)) fail(`Invalid feedback review state: ${status}`);
      manifest.feedbackDecision.reviewState = status;
      manifest.feedbackDecision.candidatesRef = options.evidenceRef || manifest.feedbackDecision.candidatesRef;
    } else if (entity === "verification") {
      if (!["not-run", "passed", "failed", "stale"].includes(status)) fail(`Invalid verification status: ${status}`);
      manifest.verification.status = status;
      manifest.verification.verifierId = options.actor || manifest.verification.verifierId;
      manifest.verification.verifiedThroughSequence = status === "passed" ? manifest.eventLog.lastSequence + 1 : manifest.verification.verifiedThroughSequence;
      manifest.verification.revision = options.revision || manifest.verification.revision;
    } else if (entity === "work-item") {
      const item = manifest.workItems.find((value) => value.id === options.id);
      if (!item) fail(`Unknown work item: ${options.id}`);
      if (!["pending", "ready", "dispatched", "running", "blocked", "completed", "failed", "skipped"].includes(status)) fail(`Invalid work item status: ${status}`);
      item.status = status;
    } else if (entity === "message") {
      const message = manifest.messages.find((value) => value.id === options.id);
      if (!message) fail(`Unknown message: ${options.id}`);
      if (!["pending", "delivered", "acknowledged"].includes(status)) fail(`Invalid message state: ${status}`);
      message.status = status;
      if (status === "delivered") message.deliveredAt = now();
      if (status === "acknowledged") message.ackedAt = now();
    } else if (entity === "run") {
      if (status === "completed") {
        if (manifest.taskKind === "business-demand" && manifest.acceptance.status !== "accepted") fail("Business-demand run cannot complete before accepted");
        if (manifest.taskKind === "framework-maintenance" && manifest.maintenance.status !== "maintenance-complete") fail("Framework-maintenance run cannot complete before maintenance-complete");
        if (manifest.workItems.some((item) => !TERMINAL_WORK.has(item.status))) fail("Run cannot complete with unfinished work items");
        if (manifest.verification.status !== "passed" || manifest.verification.verifiedThroughSequence < manifest.verification.lastMutationSequence) fail("Run cannot complete with stale or missing verification");
        manifest.completedAt = now();
      }
      manifest.status = status;
    } else fail(`Unknown transition entity: ${entity}`);
    persist(runDirectory, manifest, `${entity}.transitioned`, options.actor || manifest.coordinatorId, options.id || entity, { status, key: options.key || null, evidenceRef: options.evidenceRef || null });
    return manifest;
  });
}

function scopeConflict(left, right) {
  const a = String(left).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  const b = String(right).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function validateDag(workItems, issues) {
  const ids = new Set(workItems.map((item) => item.id));
  if (ids.size !== workItems.length) issues.push("workItems ids must be unique");
  for (const item of workItems) for (const dependency of item.dependsOn || []) if (!ids.has(dependency)) issues.push(`work item ${item.id} has unknown dependency ${dependency}`);
  const visiting = new Set();
  const visited = new Set();
  const map = new Map(workItems.map((item) => [item.id, item]));
  function visit(id) {
    if (visiting.has(id)) { issues.push(`DAG cycle detected at ${id}`); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of map.get(id)?.dependsOn || []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of ids) visit(id);
}

function validateV2(manifest, runDirectory, finalOnly, settings = {}) {
  const issues = [];
  if (manifest.schemaVersion !== SCHEMA_VERSION) issues.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (!TASK_KINDS.has(manifest.taskKind)) issues.push("taskKind must be business-demand, framework-maintenance, or other");
  if (!manifest.runId) issues.push("runId is required");
  if (!manifest.workflow?.id) issues.push("workflow.id is required");
  if (!["fast", "full", "guarded"].includes(manifest.executionPath)) issues.push("executionPath must be fast, full, or guarded");
  if (!["serial", "subagent", "multi-session"].includes(manifest.orchestration?.mode)) issues.push("orchestration.mode must be serial, subagent, or multi-session");
  const coordinators = manifest.participants.filter((item) => item.id === manifest.coordinatorId && item.role === "coordinator");
  if (coordinators.length !== 1) issues.push("exactly one coordinator participant is required");
  const participantIds = new Set(manifest.participants.map((item) => item.id));
  if (participantIds.size !== manifest.participants.length) issues.push("participant ids must be unique");
  for (const item of manifest.workItems) if (!participantIds.has(item.ownerId)) issues.push(`work item ${item.id} has unknown owner ${item.ownerId}`);
  validateDag(manifest.workItems, issues);
  const writable = manifest.participants.filter((item) => (item.writeScopes || []).length > 0);
  if (manifest.orchestration.mode === "multi-session") {
    const grant = manifest.authorizations.collaborationPlan;
    const sessionActions = manifest.actions.filter((item) => item.type === "create-session" && !["failed", "cancelled"].includes(item.status));
    if (sessionActions.length && (grant.state !== "granted" || grant.scopeHash !== manifest.orchestration.planHash)) issues.push("multi-session actions require current collaborationPlan authorization");
    for (const participant of writable) if (participant.worktree?.mode !== "isolated" || !participant.worktree?.ref) issues.push(`writable multi-session participant ${participant.id} requires isolated worktree ref`);
    for (let left = 0; left < writable.length; left += 1) for (let right = left + 1; right < writable.length; right += 1) {
      for (const a of writable[left].writeScopes) for (const b of writable[right].writeScopes) if (scopeConflict(a, b)) issues.push(`write scope conflict: ${writable[left].id}:${a} and ${writable[right].id}:${b}`);
      if (writable[left].worktree?.ref && writable[left].worktree.ref === writable[right].worktree?.ref) issues.push(`isolated worktree ref reused: ${writable[left].worktree.ref}`);
    }
  }
  const actionIds = new Set();
  const keys = new Set();
  for (const action of manifest.actions) {
    if (actionIds.has(action.id)) issues.push(`duplicate action id: ${action.id}`);
    if (keys.has(action.idempotencyKey) && !["failed", "cancelled"].includes(action.status)) issues.push(`duplicate active idempotency key: ${action.idempotencyKey}`);
    actionIds.add(action.id); keys.add(action.idempotencyKey);
    if (action.result && action.result.actionId !== action.id) issues.push(`ACK actionId mismatch: ${action.id}`);
    if (action.authorizationCategory && !["request-authorization", "prepare-integration"].includes(action.type) && !["failed", "cancelled"].includes(action.status)) {
      const grant = manifest.authorizations[action.authorizationCategory];
      if (grant?.state !== "granted" || grant.scopeHash !== manifest.orchestration.planHash) issues.push(`action ${action.id} requires current ${action.authorizationCategory} authorization`);
    }
  }
  const acceptanceStates = new Set(["implementing", "locally-verified", "acceptance-pending", "accepted"]);
  const maintenanceStates = new Set(["maintaining", "locally-verified", "maintenance-complete"]);
  if (manifest.taskKind === "business-demand") {
    if (!acceptanceStates.has(manifest.acceptance?.status)) issues.push("business-demand requires the demand acceptance lifecycle");
    if (manifest.maintenance?.status !== "not-applicable") issues.push("business-demand must not use the framework maintenance lifecycle");
    if (manifest.feedbackDecision?.applicable !== true || manifest.feedbackDecision?.applicabilityReason !== "business-demand") issues.push("business-demand requires applicable feedback review classification");
  } else if (manifest.taskKind === "framework-maintenance") {
    if (manifest.acceptance?.status !== "not-applicable") issues.push("framework-maintenance must not use demand acceptance");
    if (!maintenanceStates.has(manifest.maintenance?.status)) issues.push("framework-maintenance requires the maintenance lifecycle");
    if (manifest.feedbackDecision?.applicable !== false || manifest.feedbackDecision?.applicabilityReason !== "framework-maintenance") issues.push("framework-maintenance must not enter demand feedback review");
  } else if (manifest.taskKind === "other") {
    if (manifest.acceptance?.status !== "not-applicable" || manifest.maintenance?.status !== "not-applicable") issues.push("other tasks must not use demand or maintenance lifecycle states");
    if (manifest.feedbackDecision?.applicable !== false || manifest.feedbackDecision?.applicabilityReason !== "other") issues.push("other tasks must not enter demand feedback review");
  }
  if (manifest.acceptance?.status === "accepted" && (manifest.acceptance.acceptedBy !== "user" || !manifest.acceptance.evidenceRef)) issues.push("accepted requires user evidence");
  if (typeof manifest.feedbackDecision?.applicable !== "boolean") issues.push("feedbackDecision.applicable must be boolean");
  if (!manifest.feedbackDecision?.applicabilityReason) issues.push("feedbackDecision.applicabilityReason is required");
  if (manifest.acceptance.status !== "accepted" && manifest.feedbackDecision.reviewState !== "not-eligible") issues.push("feedback review must remain not-eligible before accepted");
  if (!manifest.feedbackDecision.applicable && manifest.feedbackDecision.reviewState !== "not-eligible") issues.push("feedback review must remain not-eligible when not applicable");
  if (manifest.acceptance.status === "accepted" && manifest.feedbackDecision.applicable && manifest.feedbackDecision.reviewState === "not-eligible") issues.push("applicable feedback review must become pending after accepted");
  if (manifest.authorizations.feedbackWrite.state === "granted" && (!manifest.feedbackDecision.applicable || manifest.acceptance.status !== "accepted")) issues.push("feedbackWrite requires applicable feedback review and accepted state");
  if (manifest.verification.status === "passed" && manifest.verification.verifiedThroughSequence < manifest.verification.lastMutationSequence) issues.push("verification is stale after final mutation");
  if (finalOnly) {
    if (manifest.workItems.some((item) => !TERMINAL_WORK.has(item.status))) issues.push("final validation requires terminal work items");
    if (manifest.actions.some((item) => item.status === "pending")) issues.push("final validation requires no pending actions");
    if (manifest.verification.status !== "passed") issues.push("final validation requires passed verification");
    if (manifest.taskKind === "business-demand" && manifest.acceptance.status !== "accepted") issues.push("final business-demand validation requires accepted state");
    if (manifest.taskKind === "framework-maintenance" && manifest.maintenance.status !== "maintenance-complete") issues.push("final framework-maintenance validation requires maintenance-complete state");
  }
  if (!settings.skipProjection && manifest.eventLog?.projectionHash !== projectionHash(manifest)) issues.push("manifest projectionHash mismatch");
  if (runDirectory) {
    const events = path.join(runDirectory, EVENT_NAME);
    if (!fs.existsSync(events)) issues.push("events.jsonl is missing");
    else {
      const lines = fs.readFileSync(events, "utf8").split(/\r?\n/).filter(Boolean);
      let expected = 1;
      for (const line of lines) {
        try { const event = JSON.parse(line); if (event.sequence !== expected) issues.push(`event sequence expected ${expected}, got ${event.sequence}`); } catch { issues.push(`invalid event JSON at sequence ${expected}`); }
        expected += 1;
      }
      if (lines.length !== manifest.eventLog.lastSequence) issues.push("eventLog.lastSequence does not match events.jsonl");
    }
    const replay = replayProjection(runDirectory);
    issues.push(...replay.issues);
    if (replay.manifest && projectionHash(replay.manifest) !== projectionHash(manifest)) issues.push("events.jsonl replay does not match manifest projection");
    for (const message of manifest.messages) if (!fs.existsSync(path.join(runDirectory, message.bodyRef))) issues.push(`message body is missing: ${message.bodyRef}`);
  }
  return [...new Set(issues)];
}

function validateLegacy(manifest, finalOnly) {
  const issues = [];
  if (!LEGACY_SCHEMAS.has(String(manifest.schemaVersion))) issues.push(`Unsupported schemaVersion: ${manifest.schemaVersion}`);
  if (!manifest.topic) issues.push("legacy topic is required");
  if (!Array.isArray(manifest.stages)) issues.push("legacy stages[] is required");
  if (finalOnly && manifest.stages?.some((item) => !["completed", "not-applicable", "blocked", "failed"].includes(item.status))) issues.push("legacy final validation requires terminal stages");
  return issues;
}

function commandValidate(options) {
  const runDirectory = requireRunDirectory(options);
  const manifest = readManifestRaw(runDirectory);
  const issues = LEGACY_SCHEMAS.has(String(manifest.schemaVersion)) ? validateLegacy(manifest, Boolean(options.final)) : validateV2(manifest, runDirectory, Boolean(options.final));
  return { valid: issues.length === 0, schemaVersion: manifest.schemaVersion, legacyReadOnly: LEGACY_SCHEMAS.has(String(manifest.schemaVersion)), issues };
}

function commandStatus(options) {
  const runDirectory = requireRunDirectory(options);
  const raw = readManifestRaw(runDirectory);
  const replay = String(raw.schemaVersion) === SCHEMA_VERSION ? replayProjection(runDirectory) : { manifest: null, issues: [] };
  const recovered = replay.manifest && replay.issues.length === 0 && projectionHash(replay.manifest) !== projectionHash(raw);
  const manifest = recovered ? replay.manifest : raw;
  return {
    schemaVersion: manifest.schemaVersion,
    legacyReadOnly: LEGACY_SCHEMAS.has(String(manifest.schemaVersion)),
    runId: manifest.runId || path.basename(runDirectory),
    topic: manifest.topic,
    taskKind: manifest.taskKind || null,
    status: manifest.status || null,
    executionPath: manifest.executionPath || null,
    orchestrationMode: manifest.orchestration?.mode || manifest.runMode || null,
    workItems: manifest.workItems || manifest.stages || [],
    pendingActions: (manifest.actions || []).filter((item) => item.status === "pending"),
    acceptance: manifest.acceptance || null,
    maintenance: manifest.maintenance || null,
    feedbackDecision: manifest.feedbackDecision || null,
    projectionRecovered: Boolean(recovered),
    replayIssues: replay.issues
  };
}

function usage() {
  return `agent-orchestrator.js <command> --run-directory <path> [options]\n\nCommands:\n  init        Create a schema 2.0 run from --plan <json>\n  next        Emit currently executable idempotent actions\n  ack         Record adapter result from --result <json>\n  message     Persist coordinator-routed communication\n  transition  Advance authorization, work, verification, demand acceptance, maintenance, feedback, or run state\n  status      Print current projection\n  validate    Validate consistency; add --final for completion gates\n`;
}

function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  if (!command || command === "help" || options.help) { process.stdout.write(usage()); return 0; }
  const handlers = { init: commandInit, next: commandNext, ack: commandAck, message: commandMessage, transition: commandTransition, status: commandStatus, validate: commandValidate };
  if (!handlers[command]) fail(`Unknown command: ${command}`);
  if (MUTATING_COMMANDS.has(command) && command !== "init") {
    const manifest = loadManifest(requireRunDirectory(options));
    assertMutable(manifest, command);
  }
  const result = handlers[command](options);
  if (command === "validate" && !result.valid) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 1;
  }
  if (options.json || typeof result !== "string") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${result}\n`);
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main(); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = error.exitCode || 1; }
}

module.exports = { SCHEMA_VERSION, createManifest, validateV2, validateLegacy, projectionHash, scopeConflict, main };
