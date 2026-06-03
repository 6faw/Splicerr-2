export function applyAuthHeader(headers: Record<string, string>, authValue: string) {
    let value = authValue.trim();
    if (!value) return;

    value = value.replace(/^Authorization:\s*/i, "").replace(/^Cookie:\s*/i, "");
    if (/^Bearer\s+/i.test(value)) {
        headers["Authorization"] = value;
        return;
    }
    if (/^eyJ/.test(value)) {
        headers["Authorization"] = `Bearer ${value}`;
        return;
    }
    headers["Cookie"] = value;
}
