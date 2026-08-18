/**
 * Reads and validates a declarative pipeline definition (P9-01).
 *
 * The parser is the gate the whole subsystem stands behind. A pipeline that
 * reaches `PipelineEngine` has already been proved to be a DAG with unique step
 * ids, resolvable roles and bounded text, so the engine contains no defensive
 * re-checking of any of that and the failure mode for a bad file is a 400 with
 * a line number rather than three agent sessions and a half-written worktree.
 *
 * Two decisions are worth stating.
 *
 * **A cycle is refused here, before anything runs.** `a → b → a` has no first
 * step, so there is nothing a scheduler could legally start; discovering that
 * during execution would mean discovering it after the steps that *could* start
 * had already edited a repository. The error names the cycle rather than
 * reporting that one exists, because the person reading it is the person who
 * has to break it.
 *
 * **A role is resolved the way a delegation resolves one.** `roleProfileId`
 * accepts a profile id, a role, or a profile's name — the same three readings
 * `AgentDelegationService` accepts — because a definition that validates and
 * then fails to dispatch would be a validator that agrees with nothing. It is
 * checked against the catalogue at parse time so a typo is caught by the save
 * that introduced it rather than by a run three weeks later.
 */

import fs from 'fs';
import path from 'path';
import {
  MAX_DELEGATION_TIMEOUT_MS,
  MAX_PIPELINE_RETRY_DELAY_MS,
  MAX_PIPELINE_STEP_RETRIES,
  MAX_PIPELINE_DESCRIPTION_CHARS,
  MAX_PIPELINE_NAME_CHARS,
  MAX_PIPELINE_PARAMETERS,
  MAX_PIPELINE_STEPS,
  MAX_PIPELINE_TASK_CHARS,
  MAX_PIPELINE_CONTEXT_CHARS,
  PIPELINE_DEFINITION_EXTENSIONS,
  PipelineDefinition,
  PipelineStep,
  PipelineTriggerType,
  findPipelineCycle,
  isValidPipelineStepId,
  topologicalPipelineOrder
} from '@asterim/shared';
import { ProfileService, profileService } from '../ai/ProfileService';
import { YamlMapping, YamlParseError, YamlValue, parseSafeYaml } from './SafeYaml';

export { YamlParseError, parseSafeYaml } from './SafeYaml';

/** A definition this parser refuses, and why. */
export class PipelineParseError extends Error {
  constructor(
    message: string,
    /** The line it was refused on, when the reader knew one. */
    public readonly line = 0
  ) {
    super(message);
    this.name = 'PipelineParseError';
  }
}

/** The triggers a definition may declare. */
const TRIGGERS: readonly PipelineTriggerType[] = ['MANUAL', 'GIT_COMMIT', 'FILE_CHANGE', 'SCHEDULE'];

/** The keys a step may carry. Anything else is a typo worth reporting. */
const STEP_KEYS: readonly string[] = [
  'id',
  'name',
  'roleProfileId',
  'role',
  'task',
  'taskDescription',
  'dependsOn',
  'inputContext',
  'context',
  'timeoutMs',
  'isolateWorktree',
  'verifyPipeline',
  'verificationSteps',
  'retries',
  'retryDelayMs'
];

/** The keys a definition may carry. */
const DEFINITION_KEYS: readonly string[] = [
  'name',
  'description',
  'projectId',
  'project',
  'trigger',
  'parameters',
  'steps'
];

export interface PipelineParseOptions {
  /**
   * Whether `roleProfileId` must resolve against the profile catalogue.
   *
   * On by default. Off for the one caller that has to read a definition without
   * a database behind it — a unit test of the grammar itself.
   */
  validateRoles?: boolean;
}

export class PipelineParser {
  constructor(private readonly profiles: ProfileService = profileService) {}

  /** One definition, or a `PipelineParseError` naming the line that stopped it. */
  public parse(yaml: string, options: PipelineParseOptions = {}): PipelineDefinition {
    let document: YamlValue;
    try {
      document = parseSafeYaml(yaml);
    } catch (err) {
      if (err instanceof YamlParseError) {
        throw new PipelineParseError(err.message, err.line);
      }
      throw new PipelineParseError(`The pipeline definition could not be read: ${describe(err)}`);
    }

    if (!isMapping(document)) {
      throw new PipelineParseError(
        'A pipeline definition must be a mapping with `name:` and `steps:`.'
      );
    }

    refuseUnknownKeys(document, DEFINITION_KEYS, 'pipeline');

    const name = requireText(document.name, 'name', MAX_PIPELINE_NAME_CHARS);
    const description = optionalText(
      document.description,
      'description',
      MAX_PIPELINE_DESCRIPTION_CHARS
    );
    const projectId = optionalText(document.projectId ?? document.project, 'projectId', 200);
    const trigger = readTrigger(document.trigger);
    const parameters = readParameters(document.parameters);
    const steps = this.readSteps(document.steps, options.validateRoles !== false);

    return {
      name,
      ...(description ? { description } : {}),
      ...(projectId ? { projectId } : {}),
      trigger,
      ...(parameters ? { parameters } : {}),
      steps
    };
  }

  /**
   * Every definition a project keeps in `.asterim/pipelines/`.
   *
   * A file that does not parse is reported rather than thrown on: one broken
   * definition in a directory must not hide the four beside it that are fine,
   * and the caller decides whether a broken file is worth failing an import for.
   */
  public parseDirectory(
    directory: string,
    options: PipelineParseOptions = {}
  ): Array<{ file: string; definition?: PipelineDefinition; error?: string }> {
    let entries: string[];
    try {
      entries = fs.readdirSync(directory);
    } catch {
      return [];
    }

    return entries
      .filter(entry => PIPELINE_DEFINITION_EXTENSIONS.includes(path.extname(entry).toLowerCase()))
      .sort()
      .map(entry => {
        const file = path.join(directory, entry);
        try {
          return { file, definition: this.parse(fs.readFileSync(file, 'utf8'), options) };
        } catch (err) {
          return { file, error: describe(err) };
        }
      });
  }

  // --- Steps ----------------------------------------------------------------

  private readSteps(value: YamlValue, validateRoles: boolean): PipelineStep[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new PipelineParseError('A pipeline must declare at least one step under `steps:`.');
    }
    if (value.length > MAX_PIPELINE_STEPS) {
      throw new PipelineParseError(
        `A pipeline may declare at most ${MAX_PIPELINE_STEPS} steps; this one declares ${value.length}.`
      );
    }

    const steps = value.map((entry, position) => this.readStep(entry, position));

    const seen = new Set<string>();
    for (const step of steps) {
      if (seen.has(step.id)) {
        throw new PipelineParseError(
          `Duplicate step id '${step.id}'. Step ids must be unique within a pipeline.`
        );
      }
      seen.add(step.id);
    }

    for (const step of steps) {
      for (const dependency of step.dependsOn) {
        if (dependency === step.id) {
          throw new PipelineParseError(`Step '${step.id}' cannot depend on itself.`);
        }
        if (!seen.has(dependency)) {
          throw new PipelineParseError(
            `Step '${step.id}' depends on '${dependency}', which no step declares.`
          );
        }
      }
    }

    const cycle = findPipelineCycle(steps);
    if (cycle) {
      throw new PipelineParseError(
        `Pipeline steps form a dependency cycle: ${cycle.join(' → ')}. A pipeline must be a directed acyclic graph.`
      );
    }
    // Belt and braces: the two disagree only if one of them is wrong, and a
    // schedule derived from a graph with no order would deadlock at runtime.
    if (!topologicalPipelineOrder(steps)) {
      throw new PipelineParseError('Pipeline steps cannot be ordered; check their dependencies.');
    }

    if (validateRoles) {
      for (const step of steps) {
        if (!this.resolvesToProfile(step.roleProfileId)) {
          const available = this.profiles
            .listProfiles()
            .map(profile => profile.role)
            .join(', ');
          throw new PipelineParseError(
            `Step '${step.id}' names role '${step.roleProfileId}', which matches no agent profile. Available roles: ${available || 'none'}.`
          );
        }
      }
    }

    return steps;
  }

  private readStep(value: YamlValue, position: number): PipelineStep {
    if (!isMapping(value)) {
      throw new PipelineParseError(`Step ${position + 1} must be a mapping.`);
    }
    refuseUnknownKeys(value, STEP_KEYS, `step ${position + 1}`);

    const id = requireText(value.id, `steps[${position}].id`, 64);
    if (!isValidPipelineStepId(id)) {
      throw new PipelineParseError(
        `Step id '${id}' is not usable. Use letters, digits, '-' and '_', starting with a letter or digit.`
      );
    }

    const roleProfileId = requireText(
      value.roleProfileId ?? value.role,
      `steps[${position}].roleProfileId`,
      200
    );
    const task = requireText(
      value.task ?? value.taskDescription,
      `steps[${position}].task`,
      MAX_PIPELINE_TASK_CHARS
    );
    const name = optionalText(value.name, `steps[${position}].name`, MAX_PIPELINE_NAME_CHARS) ?? id;
    const inputContext = optionalText(
      value.inputContext ?? value.context,
      `steps[${position}].inputContext`,
      MAX_PIPELINE_CONTEXT_CHARS
    );

    const step: PipelineStep = {
      id,
      name,
      roleProfileId,
      task,
      dependsOn: readDependsOn(value.dependsOn, position)
    };

    // Set only where the definition said something. Unset has to stay unset all
    // the way down to the delegation, whose own default — a sandbox for work,
    // none for a review — is not the same answer as `false`.
    if (inputContext) step.inputContext = inputContext;
    if (isSet(value.timeoutMs)) {
      step.timeoutMs = readTimeout(value.timeoutMs, position);
    }
    if (isSet(value.isolateWorktree)) {
      step.isolateWorktree = readBoolean(
        value.isolateWorktree,
        `steps[${position}].isolateWorktree`
      );
    }
    if (isSet(value.verifyPipeline)) {
      step.verifyPipeline = readBoolean(value.verifyPipeline, `steps[${position}].verifyPipeline`);
    }
    if (isSet(value.verificationSteps)) {
      step.verificationSteps = readStringList(
        value.verificationSteps,
        `steps[${position}].verificationSteps`
      );
    }
    // Retries are read here rather than defaulted, so `retries: 0` and a file
    // that says nothing stay the same thing all the way down to the engine —
    // one attempt (P9-02).
    if (isSet(value.retries)) {
      step.retries = readBoundedInteger(
        value.retries,
        `steps[${position}].retries`,
        0,
        MAX_PIPELINE_STEP_RETRIES
      );
    }
    if (isSet(value.retryDelayMs)) {
      step.retryDelayMs = readBoundedInteger(
        value.retryDelayMs,
        `steps[${position}].retryDelayMs`,
        0,
        MAX_PIPELINE_RETRY_DELAY_MS
      );
    }

    return step;
  }

  /** Whether a `roleProfileId` names something the catalogue can run. */
  private resolvesToProfile(reference: string): boolean {
    if (this.profiles.getProfile(reference)) return true;

    const wanted = reference.trim().toLowerCase();
    return this.profiles
      .listProfiles()
      .some(
        profile =>
          profile.role.trim().toLowerCase() === wanted ||
          profile.name.trim().toLowerCase() === wanted ||
          profile.role.trim().toLowerCase().includes(wanted) ||
          profile.name.trim().toLowerCase().includes(wanted)
      );
  }
}

export const pipelineParser = new PipelineParser();

// --- Readers -----------------------------------------------------------------

function isMapping(value: YamlValue): value is YamlMapping {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a definition said anything at all about a field. */
function isSet(value: YamlValue): boolean {
  return value !== undefined && value !== null;
}

/**
 * Refuses a key the schema does not define.
 *
 * A definition is hand-written, and a silently ignored `depends_on:` is a
 * pipeline that runs its steps in the wrong order while looking correct.
 */
function refuseUnknownKeys(
  mapping: YamlMapping,
  allowed: readonly string[],
  what: string
): void {
  const unknown = Object.keys(mapping).filter(key => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new PipelineParseError(
      `Unknown ${what} key(s): ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}.`
    );
  }
}

function requireText(value: YamlValue, field: string, limit: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new PipelineParseError(`\`${field}\` is required.`);
  if (text.length > limit) {
    throw new PipelineParseError(`\`${field}\` may be at most ${limit} characters.`);
  }
  return text;
}

function optionalText(value: YamlValue, field: string, limit: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new PipelineParseError(`\`${field}\` must be text.`);
  }
  const text = value.trim();
  if (!text) return undefined;
  if (text.length > limit) {
    throw new PipelineParseError(`\`${field}\` may be at most ${limit} characters.`);
  }
  return text;
}

function readBoolean(value: YamlValue, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new PipelineParseError(`\`${field}\` must be true or false.`);
  }
  return value;
}

function readTrigger(value: YamlValue): PipelineTriggerType {
  if (value === undefined || value === null) return 'MANUAL';
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
  const trigger = TRIGGERS.find(candidate => candidate === text);
  if (!trigger) {
    throw new PipelineParseError(`\`trigger\` must be one of: ${TRIGGERS.join(', ')}.`);
  }
  return trigger;
}

function readTimeout(value: YamlValue, position: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new PipelineParseError(`\`steps[${position}].timeoutMs\` must be a positive number.`);
  }
  if (value > MAX_DELEGATION_TIMEOUT_MS) {
    throw new PipelineParseError(
      `\`steps[${position}].timeoutMs\` may be at most ${MAX_DELEGATION_TIMEOUT_MS}.`
    );
  }
  return Math.floor(value);
}

/**
 * A whole number inside a bound, refusing everything else (P9-02).
 *
 * A bound rather than a clamp: `retries: 50` in a hand-written file is somebody
 * expecting fifty attempts, and silently running three would be a pipeline that
 * does something other than what its definition says.
 */
function readBoundedInteger(
  value: YamlValue,
  field: string,
  lowest: number,
  highest: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new PipelineParseError(`\`${field}\` must be a whole number.`);
  }
  if (value < lowest || value > highest) {
    throw new PipelineParseError(`\`${field}\` must be between ${lowest} and ${highest}.`);
  }
  return value;
}

function readDependsOn(value: YamlValue, position: number): string[] {
  if (value === undefined || value === null) return [];
  // `dependsOn: build` is what someone writes when a step has exactly one
  // dependency, and refusing it would be pedantry rather than safety.
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  return readStringList(value, `steps[${position}].dependsOn`);
}

function readStringList(value: YamlValue, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new PipelineParseError(`\`${field}\` must be a list.`);
  }
  return value.map(entry => {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new PipelineParseError(`\`${field}\` must contain only non-empty text entries.`);
    }
    return entry.trim();
  });
}

/**
 * The run's starting parameters, as text.
 *
 * Numbers and booleans are accepted and stringified: a parameter ends up
 * substituted into a brief a language model reads, and `retries: 3` should not
 * have to be quoted to be usable there.
 */
function readParameters(value: YamlValue): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isMapping(value)) {
    throw new PipelineParseError('`parameters` must be a mapping of names to values.');
  }

  const entries = Object.entries(value);
  if (entries.length === 0) return undefined;
  if (entries.length > MAX_PIPELINE_PARAMETERS) {
    throw new PipelineParseError(
      `A pipeline may declare at most ${MAX_PIPELINE_PARAMETERS} parameters.`
    );
  }

  const parameters: Record<string, string> = {};
  for (const [key, entry] of entries) {
    if (entry === null) {
      parameters[key] = '';
      continue;
    }
    if (typeof entry === 'object') {
      throw new PipelineParseError(`Parameter '${key}' must be a single value, not a collection.`);
    }
    parameters[key] = String(entry);
  }
  return parameters;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
