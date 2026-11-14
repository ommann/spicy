// A validation tool can inherit the running server's database setting.
// Tests and their child servers must select stores in their own temporary directories.
delete process.env.SPICY_HISTORY_DB;
