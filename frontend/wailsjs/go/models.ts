export namespace main {
	
	export class TradeLog {
	    date: string;
	    action: string;
	    price: number;
	
	    static createFrom(source: any = {}) {
	        return new TradeLog(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.date = source["date"];
	        this.action = source["action"];
	        this.price = source["price"];
	    }
	}
	export class BacktestResult {
	    logs: TradeLog[];
	    final_capital: number;
	    total_return: number;
	    chart_data: number[];
	    dates: string[];
	
	    static createFrom(source: any = {}) {
	        return new BacktestResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.logs = this.convertValues(source["logs"], TradeLog);
	        this.final_capital = source["final_capital"];
	        this.total_return = source["total_return"];
	        this.chart_data = source["chart_data"];
	        this.dates = source["dates"];
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

