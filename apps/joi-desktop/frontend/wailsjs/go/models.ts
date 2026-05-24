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

	export class DesktopArtifactDetail {
	    id: string;
	    type: string;
	    title: string;
	    content_format: string;
	    source_product_task_id?: string;
	    source_run_id?: string;
	    source_conversation_id?: string;
	    source_message_id?: string;
	    version: number;
	    status: string;
	    metadata?: Record<string, any>;
	    created_at?: string;
	    updated_at?: string;
	    content: string;
	    linked_memory_ids?: string[];

	    static createFrom(source: any = {}) {
	        return new DesktopArtifactDetail(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.type = source["type"];
	        this.title = source["title"];
	        this.content_format = source["content_format"];
	        this.source_product_task_id = source["source_product_task_id"];
	        this.source_run_id = source["source_run_id"];
	        this.source_conversation_id = source["source_conversation_id"];
	        this.source_message_id = source["source_message_id"];
	        this.version = source["version"];
	        this.status = source["status"];
	        this.metadata = source["metadata"];
	        this.created_at = source["created_at"];
	        this.updated_at = source["updated_at"];
	        this.content = source["content"];
	        this.linked_memory_ids = source["linked_memory_ids"];
	    }
	}
	export class DesktopArtifactFilter {
	    product_task_id: string;
	    type: string;
	    limit: number;

	    static createFrom(source: any = {}) {
	        return new DesktopArtifactFilter(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.product_task_id = source["product_task_id"];
	        this.type = source["type"];
	        this.limit = source["limit"];
	    }
	}
	export class DesktopArtifactSummary {
	    id: string;
	    type: string;
	    title: string;
	    content_format: string;
	    source_product_task_id?: string;
	    source_run_id?: string;
	    source_conversation_id?: string;
	    source_message_id?: string;
	    version: number;
	    status: string;
	    metadata?: Record<string, any>;
	    created_at?: string;
	    updated_at?: string;

	    static createFrom(source: any = {}) {
	        return new DesktopArtifactSummary(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.type = source["type"];
	        this.title = source["title"];
	        this.content_format = source["content_format"];
	        this.source_product_task_id = source["source_product_task_id"];
	        this.source_run_id = source["source_run_id"];
	        this.source_conversation_id = source["source_conversation_id"];
	        this.source_message_id = source["source_message_id"];
	        this.version = source["version"];
	        this.status = source["status"];
	        this.metadata = source["metadata"];
	        this.created_at = source["created_at"];
	        this.updated_at = source["updated_at"];
	    }
	}
	export class DesktopArtifactListResponse {
	    artifacts: DesktopArtifactSummary[];

	    static createFrom(source: any = {}) {
	        return new DesktopArtifactListResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.artifacts = this.convertValues(source["artifacts"], DesktopArtifactSummary);
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

	export class DesktopModelRuntimeConfig {
	    role: string;
	    enabled: boolean;
	    temperature: number;
	    max_output_tokens: number;
	    timeout_seconds: number;
	    max_retries: number;
	    supports_json_mode: boolean;
	    supports_tool_calling: boolean;
	    supports_reasoning: boolean;

	    static createFrom(source: any = {}) {
	        return new DesktopModelRuntimeConfig(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.role = source["role"];
	        this.enabled = source["enabled"];
	        this.temperature = source["temperature"];
	        this.max_output_tokens = source["max_output_tokens"];
	        this.timeout_seconds = source["timeout_seconds"];
	        this.max_retries = source["max_retries"];
	        this.supports_json_mode = source["supports_json_mode"];
	        this.supports_tool_calling = source["supports_tool_calling"];
	        this.supports_reasoning = source["supports_reasoning"];
	    }
	}
	export class DesktopAvailableModel {
	    id: string;
	    display_name: string;
	    owner: string;
	    object: string;
	    created: string;
	    context_window: number;
	    max_output_tokens: number;
	    input_price_per_1m: number;
	    output_price_per_1m: number;
	    supports_json_mode: boolean;
	    supports_tool_calling: boolean;
	    supports_reasoning: boolean;
	    supported_parameters: string[];
	    config: DesktopModelRuntimeConfig;
	    metadata: Record<string, any>;

	    static createFrom(source: any = {}) {
	        return new DesktopAvailableModel(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.display_name = source["display_name"];
	        this.owner = source["owner"];
	        this.object = source["object"];
	        this.created = source["created"];
	        this.context_window = source["context_window"];
	        this.max_output_tokens = source["max_output_tokens"];
	        this.input_price_per_1m = source["input_price_per_1m"];
	        this.output_price_per_1m = source["output_price_per_1m"];
	        this.supports_json_mode = source["supports_json_mode"];
	        this.supports_tool_calling = source["supports_tool_calling"];
	        this.supports_reasoning = source["supports_reasoning"];
	        this.supported_parameters = source["supported_parameters"];
	        this.config = this.convertValues(source["config"], DesktopModelRuntimeConfig);
	        this.metadata = source["metadata"];
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
	export class DesktopCapabilityRecord {
	    id: string;
	    name: string;
	    description: string;
	    risk_level: string;
	    enabled: boolean;
	    metadata: Record<string, any>;

	    static createFrom(source: any = {}) {
	        return new DesktopCapabilityRecord(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.risk_level = source["risk_level"];
	        this.enabled = source["enabled"];
	        this.metadata = source["metadata"];
	    }
	}
	export class DesktopCapabilityListResponse {
	    capabilities: DesktopCapabilityRecord[];

	    static createFrom(source: any = {}) {
	        return new DesktopCapabilityListResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.capabilities = this.convertValues(source["capabilities"], DesktopCapabilityRecord);
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
	    input_mode: string;
	    product_task_id: string;

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
	        this.input_mode = source["input_mode"];
	        this.product_task_id = source["product_task_id"];
	    }
	}
	export class DesktopProactiveMessage {
	    id: string;
	    type: string;
	    title: string;
	    body: string;
	    reason: string;
	    source_memory_ids?: string[];
	    source_open_loop_id?: string;
	    source_product_task_id?: string;
	    score: number;
	    status: string;
	    channel: string;
	    send_after?: string;
	    expires_at?: string;
	    feedback?: string;
	    metadata?: Record<string, any>;
	    created_at?: string;
	    updated_at?: string;
	    sent_at?: string;

	    static createFrom(source: any = {}) {
	        return new DesktopProactiveMessage(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.type = source["type"];
	        this.title = source["title"];
	        this.body = source["body"];
	        this.reason = source["reason"];
	        this.source_memory_ids = source["source_memory_ids"];
	        this.source_open_loop_id = source["source_open_loop_id"];
	        this.source_product_task_id = source["source_product_task_id"];
	        this.score = source["score"];
	        this.status = source["status"];
	        this.channel = source["channel"];
	        this.send_after = source["send_after"];
	        this.expires_at = source["expires_at"];
	        this.feedback = source["feedback"];
	        this.metadata = source["metadata"];
	        this.created_at = source["created_at"];
	        this.updated_at = source["updated_at"];
	        this.sent_at = source["sent_at"];
	    }
	}
	export class DesktopProductTask {
	    id: string;
	    title: string;
	    description: string;
	    status: string;
	    mode: string;
	    priority: string;
	    created_from_conversation_id?: string;
	    created_from_message_id?: string;
	    latest_run_id?: string;
	    owner_user_id?: string;
	    source_channel?: string;
	    risk_level: string;
	    progress_percent: number;
	    current_step_id?: string;
	    summary?: string;
	    metadata?: Record<string, any>;
	    created_at?: string;
	    updated_at?: string;
	    completed_at?: string;

	    static createFrom(source: any = {}) {
	        return new DesktopProductTask(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.status = source["status"];
	        this.mode = source["mode"];
	        this.priority = source["priority"];
	        this.created_from_conversation_id = source["created_from_conversation_id"];
	        this.created_from_message_id = source["created_from_message_id"];
	        this.latest_run_id = source["latest_run_id"];
	        this.owner_user_id = source["owner_user_id"];
	        this.source_channel = source["source_channel"];
	        this.risk_level = source["risk_level"];
	        this.progress_percent = source["progress_percent"];
	        this.current_step_id = source["current_step_id"];
	        this.summary = source["summary"];
	        this.metadata = source["metadata"];
	        this.created_at = source["created_at"];
	        this.updated_at = source["updated_at"];
	        this.completed_at = source["completed_at"];
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
	    product_task?: DesktopProductTask;
	    artifacts?: DesktopArtifactSummary[];
	    proactive_candidates?: DesktopProactiveMessage[];

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
	        this.product_task = this.convertValues(source["product_task"], DesktopProductTask);
	        this.artifacts = this.convertValues(source["artifacts"], DesktopArtifactSummary);
	        this.proactive_candidates = this.convertValues(source["proactive_candidates"], DesktopProactiveMessage);
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
	    available_models: DesktopAvailableModel[];

	    static createFrom(source: any = {}) {
	        return new DesktopConnectionTestResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.status = source["status"];
	        this.error_summary = source["error_summary"];
	        this.available_models = this.convertValues(source["available_models"], DesktopAvailableModel);
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
	export class DesktopConversationMessage {
	    id: string;
	    conversation_id: string;
	    role: string;
	    content: string;
	    run_id: string;
	    attachments: any[];
	    metadata: Record<string, any>;
	    created_at?: string;

	    static createFrom(source: any = {}) {
	        return new DesktopConversationMessage(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.conversation_id = source["conversation_id"];
	        this.role = source["role"];
	        this.content = source["content"];
	        this.run_id = source["run_id"];
	        this.attachments = source["attachments"];
	        this.metadata = source["metadata"];
	        this.created_at = source["created_at"];
	    }
	}
	export class DesktopConversationSummary {
	    id: string;
	    channel: string;
	    user_id: string;
	    title: string;
	    active_agent_id: string;
	    topic: string;
	    last_message: string;
	    last_role: string;
	    latest_run_id: string;
	    message_count: number;
	    metadata: Record<string, any>;
	    created_at?: string;
	    updated_at?: string;

	    static createFrom(source: any = {}) {
	        return new DesktopConversationSummary(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.channel = source["channel"];
	        this.user_id = source["user_id"];
	        this.title = source["title"];
	        this.active_agent_id = source["active_agent_id"];
	        this.topic = source["topic"];
	        this.last_message = source["last_message"];
	        this.last_role = source["last_role"];
	        this.latest_run_id = source["latest_run_id"];
	        this.message_count = source["message_count"];
	        this.metadata = source["metadata"];
	        this.created_at = source["created_at"];
	        this.updated_at = source["updated_at"];
	    }
	}
	export class DesktopConversationDetailResponse {
	    conversation: DesktopConversationSummary;
	    messages: DesktopConversationMessage[];

	    static createFrom(source: any = {}) {
	        return new DesktopConversationDetailResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.conversation = this.convertValues(source["conversation"], DesktopConversationSummary);
	        this.messages = this.convertValues(source["messages"], DesktopConversationMessage);
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
	export class DesktopConversationListResponse {
	    conversations: DesktopConversationSummary[];

	    static createFrom(source: any = {}) {
	        return new DesktopConversationListResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.conversations = this.convertValues(source["conversations"], DesktopConversationSummary);
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


	export class DesktopDiagnosticsExportResponse {
	    path: string;

	    static createFrom(source: any = {}) {
	        return new DesktopDiagnosticsExportResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
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
	    content: string;
	    summary: string;
	    scope_type: string;
	    run_id: string;

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
	        this.content = source["content"];
	        this.summary = source["summary"];
	        this.scope_type = source["scope_type"];
	        this.run_id = source["run_id"];
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
	export class DesktopModelConnectionTestRequest {
	    provider: string;
	    base_url: string;
	    name: string;
	    api_key: string;
	    timeout_seconds: number;

	    static createFrom(source: any = {}) {
	        return new DesktopModelConnectionTestRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.base_url = source["base_url"];
	        this.name = source["name"];
	        this.api_key = source["api_key"];
	        this.timeout_seconds = source["timeout_seconds"];
	    }
	}

	export class DesktopModelSettingsRequest {
	    provider: string;
	    base_url: string;
	    model_id: string;
	    display_name: string;
	    role: string;
	    enabled: boolean;
	    temperature: number;
	    max_output_tokens: number;
	    timeout_seconds: number;
	    max_retries: number;
	    supports_json_mode: boolean;
	    supports_tool_calling: boolean;
	    supports_reasoning: boolean;

	    static createFrom(source: any = {}) {
	        return new DesktopModelSettingsRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.base_url = source["base_url"];
	        this.model_id = source["model_id"];
	        this.display_name = source["display_name"];
	        this.role = source["role"];
	        this.enabled = source["enabled"];
	        this.temperature = source["temperature"];
	        this.max_output_tokens = source["max_output_tokens"];
	        this.timeout_seconds = source["timeout_seconds"];
	        this.max_retries = source["max_retries"];
	        this.supports_json_mode = source["supports_json_mode"];
	        this.supports_tool_calling = source["supports_tool_calling"];
	        this.supports_reasoning = source["supports_reasoning"];
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
	export class DesktopOpenLoop {
	    id: string;
	    topic: string;
	    description?: string;
	    status: string;
	    source_conversation_id?: string;
	    source_run_id?: string;
	    source_product_task_id?: string;
	    suggested_followup?: string;
	    priority: string;
	    due_at?: string;
	    metadata?: Record<string, any>;
	    created_at?: string;
	    updated_at?: string;
	    closed_at?: string;

	    static createFrom(source: any = {}) {
	        return new DesktopOpenLoop(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.topic = source["topic"];
	        this.description = source["description"];
	        this.status = source["status"];
	        this.source_conversation_id = source["source_conversation_id"];
	        this.source_run_id = source["source_run_id"];
	        this.source_product_task_id = source["source_product_task_id"];
	        this.suggested_followup = source["suggested_followup"];
	        this.priority = source["priority"];
	        this.due_at = source["due_at"];
	        this.metadata = source["metadata"];
	        this.created_at = source["created_at"];
	        this.updated_at = source["updated_at"];
	        this.closed_at = source["closed_at"];
	    }
	}
	export class DesktopOpenLoopFilter {
	    status: string;
	    limit: number;

	    static createFrom(source: any = {}) {
	        return new DesktopOpenLoopFilter(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.limit = source["limit"];
	    }
	}
	export class DesktopOpenLoopListResponse {
	    open_loops: DesktopOpenLoop[];

	    static createFrom(source: any = {}) {
	        return new DesktopOpenLoopListResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.open_loops = this.convertValues(source["open_loops"], DesktopOpenLoop);
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
	export class DesktopOperationalSettingsRequest {
	    telegram_enabled: boolean;
	    telegram_allowed_user_ids: string;
	    worker_gateway_enabled: boolean;
	    backup_dir: string;
	    auto_backup_enabled: boolean;

	    static createFrom(source: any = {}) {
	        return new DesktopOperationalSettingsRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.telegram_enabled = source["telegram_enabled"];
	        this.telegram_allowed_user_ids = source["telegram_allowed_user_ids"];
	        this.worker_gateway_enabled = source["worker_gateway_enabled"];
	        this.backup_dir = source["backup_dir"];
	        this.auto_backup_enabled = source["auto_backup_enabled"];
	    }
	}
	export class DesktopProactiveDecisionRequest {
	    id: string;
	    action: string;
	    feedback: string;

	    static createFrom(source: any = {}) {
	        return new DesktopProactiveDecisionRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.action = source["action"];
	        this.feedback = source["feedback"];
	    }
	}

	export class DesktopProactiveMessageFilter {
	    status: string;
	    limit: number;

	    static createFrom(source: any = {}) {
	        return new DesktopProactiveMessageFilter(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.limit = source["limit"];
	    }
	}
	export class DesktopProactiveMessageListResponse {
	    messages: DesktopProactiveMessage[];

	    static createFrom(source: any = {}) {
	        return new DesktopProactiveMessageListResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.messages = this.convertValues(source["messages"], DesktopProactiveMessage);
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

	export class DesktopProductTaskStep {
	    id: string;
	    product_task_id: string;
	    title: string;
	    description?: string;
	    status: string;
	    sort_order: number;
	    capability_id?: string;
	    tool_workflow_id?: string;
	    run_id?: string;
	    tool_run_id?: string;
	    worker_task_id?: string;
	    summary?: string;
	    input?: Record<string, any>;
	    output?: Record<string, any>;
	    error?: Record<string, any>;
	    started_at?: string;
	    finished_at?: string;
	    created_at?: string;
	    updated_at?: string;

	    static createFrom(source: any = {}) {
	        return new DesktopProductTaskStep(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.product_task_id = source["product_task_id"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.status = source["status"];
	        this.sort_order = source["sort_order"];
	        this.capability_id = source["capability_id"];
	        this.tool_workflow_id = source["tool_workflow_id"];
	        this.run_id = source["run_id"];
	        this.tool_run_id = source["tool_run_id"];
	        this.worker_task_id = source["worker_task_id"];
	        this.summary = source["summary"];
	        this.input = source["input"];
	        this.output = source["output"];
	        this.error = source["error"];
	        this.started_at = source["started_at"];
	        this.finished_at = source["finished_at"];
	        this.created_at = source["created_at"];
	        this.updated_at = source["updated_at"];
	    }
	}
	export class DesktopProductTaskDetail {
	    task: DesktopProductTask;
	    steps: DesktopProductTaskStep[];
	    deliverables: DesktopArtifactSummary[];

	    static createFrom(source: any = {}) {
	        return new DesktopProductTaskDetail(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.task = this.convertValues(source["task"], DesktopProductTask);
	        this.steps = this.convertValues(source["steps"], DesktopProductTaskStep);
	        this.deliverables = this.convertValues(source["deliverables"], DesktopArtifactSummary);
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
	export class DesktopProductTaskFilter {
	    status: string;
	    limit: number;

	    static createFrom(source: any = {}) {
	        return new DesktopProductTaskFilter(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.limit = source["limit"];
	    }
	}
	export class DesktopProductTaskListResponse {
	    tasks: DesktopProductTask[];

	    static createFrom(source: any = {}) {
	        return new DesktopProductTaskListResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tasks = this.convertValues(source["tasks"], DesktopProductTask);
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
	    log_dir: string;
	    model_provider: string;
	    model_name: string;
	    model_base_url: string;
	    telegram_enabled: boolean;
	    telegram_allowed_user_ids: string;
	    worker_gateway: string;
	    worker_gateway_enabled: boolean;
	    backup_dir: string;
	    auto_backup_enabled: boolean;
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
	        this.log_dir = source["log_dir"];
	        this.model_provider = source["model_provider"];
	        this.model_name = source["model_name"];
	        this.model_base_url = source["model_base_url"];
	        this.telegram_enabled = source["telegram_enabled"];
	        this.telegram_allowed_user_ids = source["telegram_allowed_user_ids"];
	        this.worker_gateway = source["worker_gateway"];
	        this.worker_gateway_enabled = source["worker_gateway_enabled"];
	        this.backup_dir = source["backup_dir"];
	        this.auto_backup_enabled = source["auto_backup_enabled"];
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
	export class DesktopTelegramConfigRequest {
	    token: string;
	    allowed_user_ids: string;
	    enabled: boolean;

	    static createFrom(source: any = {}) {
	        return new DesktopTelegramConfigRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.token = source["token"];
	        this.allowed_user_ids = source["allowed_user_ids"];
	        this.enabled = source["enabled"];
	    }
	}
	export class DesktopTelegramTestMessageRequest {
	    chat_id: string;
	    message: string;

	    static createFrom(source: any = {}) {
	        return new DesktopTelegramTestMessageRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.chat_id = source["chat_id"];
	        this.message = source["message"];
	    }
	}
	export class DesktopToolRunRecord {
	    id: string;
	    run_id?: string;
	    task_id?: string;
	    capability_id?: string;
	    workflow_name?: string;
	    tool_id?: string;
	    tool_name: string;
	    node_id?: string;
	    assignment_reason?: string;
	    risk_level: string;
	    status: string;
	    input?: Record<string, any>;
	    output?: Record<string, any>;
	    error?: Record<string, any>;
	    started_at?: string;
	    finished_at?: string;
	    duration_ms?: number;
	    created_at?: string;

	    static createFrom(source: any = {}) {
	        return new DesktopToolRunRecord(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.run_id = source["run_id"];
	        this.task_id = source["task_id"];
	        this.capability_id = source["capability_id"];
	        this.workflow_name = source["workflow_name"];
	        this.tool_id = source["tool_id"];
	        this.tool_name = source["tool_name"];
	        this.node_id = source["node_id"];
	        this.assignment_reason = source["assignment_reason"];
	        this.risk_level = source["risk_level"];
	        this.status = source["status"];
	        this.input = source["input"];
	        this.output = source["output"];
	        this.error = source["error"];
	        this.started_at = source["started_at"];
	        this.finished_at = source["finished_at"];
	        this.duration_ms = source["duration_ms"];
	        this.created_at = source["created_at"];
	    }
	}
	export class DesktopToolRunListResponse {
	    tool_runs: DesktopToolRunRecord[];

	    static createFrom(source: any = {}) {
	        return new DesktopToolRunListResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tool_runs = this.convertValues(source["tool_runs"], DesktopToolRunRecord);
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

	export class DesktopToolWorkflowEnabledRequest {
	    name: string;
	    enabled: boolean;

	    static createFrom(source: any = {}) {
	        return new DesktopToolWorkflowEnabledRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.enabled = source["enabled"];
	    }
	}
	export class DesktopToolWorkflowStep {
	    tool: string;
	    args?: Record<string, any>;
	    risk_level: string;

	    static createFrom(source: any = {}) {
	        return new DesktopToolWorkflowStep(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tool = source["tool"];
	        this.args = source["args"];
	        this.risk_level = source["risk_level"];
	    }
	}
	export class DesktopToolWorkflowRecord {
	    id: string;
	    capability_id: string;
	    name: string;
	    version: string;
	    risk_level: string;
	    steps: DesktopToolWorkflowStep[];
	    enabled: boolean;
	    metadata: Record<string, any>;
	    created_at?: string;
	    updated_at?: string;

	    static createFrom(source: any = {}) {
	        return new DesktopToolWorkflowRecord(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.capability_id = source["capability_id"];
	        this.name = source["name"];
	        this.version = source["version"];
	        this.risk_level = source["risk_level"];
	        this.steps = this.convertValues(source["steps"], DesktopToolWorkflowStep);
	        this.enabled = source["enabled"];
	        this.metadata = source["metadata"];
	        this.created_at = source["created_at"];
	        this.updated_at = source["updated_at"];
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
	export class DesktopToolWorkflowListResponse {
	    workflows: DesktopToolWorkflowRecord[];

	    static createFrom(source: any = {}) {
	        return new DesktopToolWorkflowListResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.workflows = this.convertValues(source["workflows"], DesktopToolWorkflowRecord);
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


	export class DesktopWorkerGatewayAuditRecord {
	    id: string;
	    node_id: string;
	    action: string;
	    status: string;
	    reason: string;
	    metadata: Record<string, any>;

	    static createFrom(source: any = {}) {
	        return new DesktopWorkerGatewayAuditRecord(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.node_id = source["node_id"];
	        this.action = source["action"];
	        this.status = source["status"];
	        this.reason = source["reason"];
	        this.metadata = source["metadata"];
	    }
	}
	export class DesktopWorkerGatewayAuditResponse {
	    items: DesktopWorkerGatewayAuditRecord[];

	    static createFrom(source: any = {}) {
	        return new DesktopWorkerGatewayAuditResponse(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.items = this.convertValues(source["items"], DesktopWorkerGatewayAuditRecord);
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
	export class DesktopWorkspaceSettings {
	    allowed_roots: string[];
	    default_root: string;
	    browser_allowed_hosts: string[];
	    web_research_allow_private_hosts: boolean;
	    file_analyze_max_bytes: number;
	    workspace_search_max_results: number;

	    static createFrom(source: any = {}) {
	        return new DesktopWorkspaceSettings(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.allowed_roots = source["allowed_roots"];
	        this.default_root = source["default_root"];
	        this.browser_allowed_hosts = source["browser_allowed_hosts"];
	        this.web_research_allow_private_hosts = source["web_research_allow_private_hosts"];
	        this.file_analyze_max_bytes = source["file_analyze_max_bytes"];
	        this.workspace_search_max_results = source["workspace_search_max_results"];
	    }
	}

}

