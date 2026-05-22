export namespace appcore {

	export class BackupRecord {
	    path: string;
	    name: string;
	    size: number;
	    modified: string;
	    manifest: Record<string, any>;

	    static createFrom(source: any = {}) {
	        return new BackupRecord(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	        this.size = source["size"];
	        this.modified = source["modified"];
	        this.manifest = source["manifest"];
	    }
	}

}

export namespace main {

	export class DesktopBackupCreateResponse {
	    path: string;

	    static createFrom(source: any = {}) {
	        return new DesktopBackupCreateResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	    }
	}
	export class DesktopBackupListResponse {
	    backups: appcore.BackupRecord[];

	    static createFrom(source: any = {}) {
	        return new DesktopBackupListResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.backups = this.convertValues(source["backups"], appcore.BackupRecord);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DesktopChatRequest {
	    conversation_id: string;
	    channel: string;
	    user_id: string;
	    message: string;
	    preferred_node: string;
	    allow_worker: boolean;

	    static createFrom(source: any = {}) {
	        return new DesktopChatRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.conversation_id = source["conversation_id"];
	        this.channel = source["channel"];
	        this.user_id = source["user_id"];
	        this.message = source["message"];
	        this.preferred_node = source["preferred_node"];
	        this.allow_worker = source["allow_worker"];
	    }
	}
	export class DesktopModelCall {
	    id: string;
	    provider: string;
	    model_name: string;
	    status: string;
	    input_tokens: number;
	    output_tokens: number;
	    cached_input_tokens: number;
	    cacheable_prefix_tokens: number;
	    dynamic_tail_tokens: number;
	    latency_ms: number;
	    prompt_cache_key: string;
	    prefix_hash: string;
	    dynamic_tail_hash: string;
	    metadata: Record<string, any>;

	    static createFrom(source: any = {}) {
	        return new DesktopModelCall(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.provider = source["provider"];
	        this.model_name = source["model_name"];
	        this.status = source["status"];
	        this.input_tokens = source["input_tokens"];
	        this.output_tokens = source["output_tokens"];
	        this.cached_input_tokens = source["cached_input_tokens"];
	        this.cacheable_prefix_tokens = source["cacheable_prefix_tokens"];
	        this.dynamic_tail_tokens = source["dynamic_tail_tokens"];
	        this.latency_ms = source["latency_ms"];
	        this.prompt_cache_key = source["prompt_cache_key"];
	        this.prefix_hash = source["prefix_hash"];
	        this.dynamic_tail_hash = source["dynamic_tail_hash"];
	        this.metadata = source["metadata"];
	    }
	}
	export class DesktopRunStep {
	    id: string;
	    step_type: string;
	    title: string;
	    status: string;
	    input?: Record<string, any>;
	    output?: Record<string, any>;
	    error?: Record<string, any>;

	    static createFrom(source: any = {}) {
	        return new DesktopRunStep(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.step_type = source["step_type"];
	        this.title = source["title"];
	        this.status = source["status"];
	        this.input = source["input"];
	        this.output = source["output"];
	        this.error = source["error"];
	    }
	}
	export class DesktopChatResponse {
	    conversation_id: string;
	    user_message_id: string;
	    assistant_message_id: string;
	    run_id: string;
	    selected_agent_id: string;
	    response: string;
	    steps: DesktopRunStep[];
	    model_calls: DesktopModelCall[];

	    static createFrom(source: any = {}) {
	        return new DesktopChatResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.conversation_id = source["conversation_id"];
	        this.user_message_id = source["user_message_id"];
	        this.assistant_message_id = source["assistant_message_id"];
	        this.run_id = source["run_id"];
	        this.selected_agent_id = source["selected_agent_id"];
	        this.response = source["response"];
	        this.steps = this.convertValues(source["steps"], DesktopRunStep);
	        this.model_calls = this.convertValues(source["model_calls"], DesktopModelCall);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DesktopConfirmation {
	    id: string;
	    run_id: string;
	    capability_id: string;
	    requested_action: string;
	    risk_level: string;
	    status: string;
	    input: Record<string, any>;
	    approved_by: string;
	    rejected_by: string;
	    decision_reason: string;

	    static createFrom(source: any = {}) {
	        return new DesktopConfirmation(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.run_id = source["run_id"];
	        this.capability_id = source["capability_id"];
	        this.requested_action = source["requested_action"];
	        this.risk_level = source["risk_level"];
	        this.status = source["status"];
	        this.input = source["input"];
	        this.approved_by = source["approved_by"];
	        this.rejected_by = source["rejected_by"];
	        this.decision_reason = source["decision_reason"];
	    }
	}
	export class DesktopConfirmationDecisionRequest {
	    id: string;
	    approve: boolean;
	    actor: string;
	    reason: string;

	    static createFrom(source: any = {}) {
	        return new DesktopConfirmationDecisionRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.approve = source["approve"];
	        this.actor = source["actor"];
	        this.reason = source["reason"];
	    }
	}
	export class DesktopConfirmationListResponse {
	    items: DesktopConfirmation[];

	    static createFrom(source: any = {}) {
	        return new DesktopConfirmationListResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.items = this.convertValues(source["items"], DesktopConfirmation);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DesktopConnectionTestResponse {
	    ok: boolean;
	    status: string;
	    error_summary: string;

	    static createFrom(source: any = {}) {
	        return new DesktopConnectionTestResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.status = source["status"];
	        this.error_summary = source["error_summary"];
	    }
	}
	export class DesktopMemory {
	    id: string;
	    type: string;
	    content: string;
	    summary: string;
	    status: string;
	    confidence: number;
	    pinned: boolean;
	    disabled: boolean;
	    usage_count: number;
	    success_count: number;
	    failure_count: number;
	    positive_feedback: number;
	    negative_feedback: number;
	    source_event_ids: string[];
	    entities: any[];
	    merged_into_memory_id: string;
	    conflict_group_id: string;
	    conflict_reason: string;
	    metadata: Record<string, any>;

	    static createFrom(source: any = {}) {
	        return new DesktopMemory(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.type = source["type"];
	        this.content = source["content"];
	        this.summary = source["summary"];
	        this.status = source["status"];
	        this.confidence = source["confidence"];
	        this.pinned = source["pinned"];
	        this.disabled = source["disabled"];
	        this.usage_count = source["usage_count"];
	        this.success_count = source["success_count"];
	        this.failure_count = source["failure_count"];
	        this.positive_feedback = source["positive_feedback"];
	        this.negative_feedback = source["negative_feedback"];
	        this.source_event_ids = source["source_event_ids"];
	        this.entities = source["entities"];
	        this.merged_into_memory_id = source["merged_into_memory_id"];
	        this.conflict_group_id = source["conflict_group_id"];
	        this.conflict_reason = source["conflict_reason"];
	        this.metadata = source["metadata"];
	    }
	}
	export class DesktopMemoryActionRequest {
	    id: string;
	    action: string;
	    feedback: string;
	    comment: string;
	    target_id: string;
	    reason: string;

	    static createFrom(source: any = {}) {
	        return new DesktopMemoryActionRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.action = source["action"];
	        this.feedback = source["feedback"];
	        this.comment = source["comment"];
	        this.target_id = source["target_id"];
	        this.reason = source["reason"];
	    }
	}
	export class DesktopMemoryContextPack {
	    id: string;
	    agent_id: string;
	    memory_profile_version: string;
	    profile: any[];
	    project_facts: any[];
	    relevant_episodes: any[];
	    heuristics: any[];
	    anti_patterns: any[];
	    open_issues: any[];
	    dynamic_retrieval: any[];
	    metadata: Record<string, any>;

	    static createFrom(source: any = {}) {
	        return new DesktopMemoryContextPack(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.agent_id = source["agent_id"];
	        this.memory_profile_version = source["memory_profile_version"];
	        this.profile = source["profile"];
	        this.project_facts = source["project_facts"];
	        this.relevant_episodes = source["relevant_episodes"];
	        this.heuristics = source["heuristics"];
	        this.anti_patterns = source["anti_patterns"];
	        this.open_issues = source["open_issues"];
	        this.dynamic_retrieval = source["dynamic_retrieval"];
	        this.metadata = source["metadata"];
	    }
	}
	export class DesktopMemoryFilter {
	    query: string;
	    limit: number;

	    static createFrom(source: any = {}) {
	        return new DesktopMemoryFilter(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.query = source["query"];
	        this.limit = source["limit"];
	    }
	}
	export class DesktopMemoryListResponse {
	    memories: DesktopMemory[];

	    static createFrom(source: any = {}) {
	        return new DesktopMemoryListResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.memories = this.convertValues(source["memories"], DesktopMemory);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

	export class DesktopModelConfigRequest {
	    provider: string;
	    base_url: string;
	    name: string;
	    timeout_seconds: number;
	    max_retries: number;

	    static createFrom(source: any = {}) {
	        return new DesktopModelConfigRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.base_url = source["base_url"];
	        this.name = source["name"];
	        this.timeout_seconds = source["timeout_seconds"];
	        this.max_retries = source["max_retries"];
	    }
	}
	export class DesktopModelUsageResponse {
	    items: any[];

	    static createFrom(source: any = {}) {
	        return new DesktopModelUsageResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.items = source["items"];
	    }
	}
	export class DesktopNode {
	    id: string;
	    name: string;
	    role: string;
	    status: string;
	    capabilities: any[];
	    auto_assign_enabled: boolean;
	    manual_assign_enabled: boolean;
	    metadata: Record<string, any>;

	    static createFrom(source: any = {}) {
	        return new DesktopNode(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.role = source["role"];
	        this.status = source["status"];
	        this.capabilities = source["capabilities"];
	        this.auto_assign_enabled = source["auto_assign_enabled"];
	        this.manual_assign_enabled = source["manual_assign_enabled"];
	        this.metadata = source["metadata"];
	    }
	}
	export class DesktopNodeListResponse {
	    nodes: DesktopNode[];

	    static createFrom(source: any = {}) {
	        return new DesktopNodeListResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.nodes = this.convertValues(source["nodes"], DesktopNode);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DesktopOnboardingStatusResponse {
	    required: boolean;
	    completed: boolean;
	    model_configured: boolean;
	    telegram_configured: boolean;
	    worker_configured: boolean;
	    first_backup_created: boolean;
	    backup_count: number;
	    missing: string[];

	    static createFrom(source: any = {}) {
	        return new DesktopOnboardingStatusResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.required = source["required"];
	        this.completed = source["completed"];
	        this.model_configured = source["model_configured"];
	        this.telegram_configured = source["telegram_configured"];
	        this.worker_configured = source["worker_configured"];
	        this.first_backup_created = source["first_backup_created"];
	        this.backup_count = source["backup_count"];
	        this.missing = source["missing"];
	    }
	}
	export class DesktopPromptAssembly {
	    id: string;
	    agent_id: string;
	    model_id: string;
	    prefix_hash: string;
	    dynamic_tail_hash: string;
	    prompt_cache_key: string;
	    memory_profile_version: string;
	    tool_schema_version: string;
	    metadata: Record<string, any>;

	    static createFrom(source: any = {}) {
	        return new DesktopPromptAssembly(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.agent_id = source["agent_id"];
	        this.model_id = source["model_id"];
	        this.prefix_hash = source["prefix_hash"];
	        this.dynamic_tail_hash = source["dynamic_tail_hash"];
	        this.prompt_cache_key = source["prompt_cache_key"];
	        this.memory_profile_version = source["memory_profile_version"];
	        this.tool_schema_version = source["tool_schema_version"];
	        this.metadata = source["metadata"];
	    }
	}

	export class DesktopRunTrace {
	    id: string;
	    conversation_id: string;
	    user_message_id: string;
	    status: string;
	    selected_agent_id: string;
	    route_result: Record<string, any>;
	    metadata: Record<string, any>;
	    prompt_assemblies: DesktopPromptAssembly[];
	    model_calls: DesktopModelCall[];
	    memory_context_packs: DesktopMemoryContextPack[];
	    steps: DesktopRunStep[];

	    static createFrom(source: any = {}) {
	        return new DesktopRunTrace(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.conversation_id = source["conversation_id"];
	        this.user_message_id = source["user_message_id"];
	        this.status = source["status"];
	        this.selected_agent_id = source["selected_agent_id"];
	        this.route_result = source["route_result"];
	        this.metadata = source["metadata"];
	        this.prompt_assemblies = this.convertValues(source["prompt_assemblies"], DesktopPromptAssembly);
	        this.model_calls = this.convertValues(source["model_calls"], DesktopModelCall);
	        this.memory_context_packs = this.convertValues(source["memory_context_packs"], DesktopMemoryContextPack);
	        this.steps = this.convertValues(source["steps"], DesktopRunStep);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DesktopSecretRequest {
	    name: string;
	    value: string;

	    static createFrom(source: any = {}) {
	        return new DesktopSecretRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.value = source["value"];
	    }
	}
	export class DesktopSecretStatusResponse {
	    secrets: Record<string, boolean>;

	    static createFrom(source: any = {}) {
	        return new DesktopSecretStatusResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.secrets = source["secrets"];
	    }
	}
	export class DesktopSettingsResponse {
	    version: string;
	    app_mode: string;
	    data_store: string;
	    task_queue: string;
	    sqlite_path: string;
	    model_provider: string;
	    model_name: string;
	    model_base_url: string;
	    telegram_enabled: boolean;
	    worker_gateway: string;
	    backup_dir: string;
	    docker_required: boolean;

	    static createFrom(source: any = {}) {
	        return new DesktopSettingsResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.app_mode = source["app_mode"];
	        this.data_store = source["data_store"];
	        this.task_queue = source["task_queue"];
	        this.sqlite_path = source["sqlite_path"];
	        this.model_provider = source["model_provider"];
	        this.model_name = source["model_name"];
	        this.model_base_url = source["model_base_url"];
	        this.telegram_enabled = source["telegram_enabled"];
	        this.worker_gateway = source["worker_gateway"];
	        this.backup_dir = source["backup_dir"];
	        this.docker_required = source["docker_required"];
	    }
	}
	export class DesktopSystemHealthResponse {
	    service_status: Record<string, any>;
	    queue_status: Record<string, any>;
	    worker_status: DesktopNode[];
	    model_latency: Record<string, any>;
	    tool_failure_rate: Record<string, any>;
	    token_cost_today: Record<string, any>;
	    warnings: any[];

	    static createFrom(source: any = {}) {
	        return new DesktopSystemHealthResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.service_status = source["service_status"];
	        this.queue_status = source["queue_status"];
	        this.worker_status = this.convertValues(source["worker_status"], DesktopNode);
	        this.model_latency = source["model_latency"];
	        this.tool_failure_rate = source["tool_failure_rate"];
	        this.token_cost_today = source["token_cost_today"];
	        this.warnings = source["warnings"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DesktopWorkerTokenResponse {
	    token: string;

	    static createFrom(source: any = {}) {
	        return new DesktopWorkerTokenResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.token = source["token"];
	    }
	}

}

