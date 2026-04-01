declare module 'better-sqlite3' {
	namespace Database {
		interface Database {
			pragma(pragma: string): any;
			prepare(sql: string): any;
			exec(sql: string): void;
			transaction<T extends (...args: any[]) => any>(fn: T): T;
		}
	}

	interface DatabaseConstructor {
		new (filename: string, options?: unknown): Database.Database;
	}

	const Database: DatabaseConstructor;
	export = Database;
}

declare module 'adm-zip';
