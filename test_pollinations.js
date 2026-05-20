const prompt = "Give me a GRE word";
const url = `https://text.pollinations.ai/prompt/${encodeURIComponent(prompt)}`;
fetch(url, {
    method: 'GET',
    headers: {
        'Origin': 'http://localhost:8080',
        'Referer': 'http://localhost:8080/'
    }
})
.then(res => res.text())
.then(text => console.log("Response:", text))
.catch(err => console.error("Error:", err));
