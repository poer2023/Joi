export namespace main {
	
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
	export class DesktopMemory {
	    id: string;
	    type: string;
	    content: string;
	    summary: string;
	    status: string;
	    confidence: number;
	    pinned: boolean;
	    usage_count: number;
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
	        this.usage_count = source["usage_count"];
	        this.metadata = source["metadata"];
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

}

