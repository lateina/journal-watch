async function run() {
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/rotationstool-stefan/databases/(default)/documents/up_config/main?key=AIzaSyAopuMnqYLzaG3ZOK5CurDLvZHU26beqjk`);
    const data = await res.json();
    
    function fromFirestore(fields) {
        if (!fields) return {};
        const res = {};
        for (const [key, value] of Object.entries(fields)) {
            if (value.stringValue !== undefined) res[key] = value.stringValue;
            else if (value.arrayValue !== undefined) res[key] = (value.arrayValue.values || []).map(v => v.stringValue || (v.mapValue ? fromFirestore(v.mapValue.fields) : v));
            else if (value.mapValue !== undefined) res[key] = fromFirestore(value.mapValue.fields);
            else if (value.booleanValue !== undefined) res[key] = value.booleanValue;
            else if (value.integerValue !== undefined) res[key] = parseInt(value.integerValue, 10);
            else if (value.timestampValue !== undefined) res[key] = value.timestampValue;
        }
        return res;
    }
    const config = fromFirestore(data.fields);
    const employees = config.employees || [];
    
    console.log(employees.filter(e => e.name && e.name.toLowerCase().includes('sekretariat')));
}
run();
