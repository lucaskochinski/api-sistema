async function main() {
  const pageId = "35d7ce4c-f349-80e0-8d1b-d6de0355afa8";
  console.log("🔍 Fetching getRecordValues from capitalprime.notion.site for:", pageId);

  const payload = {
    requests: [
      {
        id: pageId,
        table: "block"
      }
    ]
  };

  try {
    const response = await fetch("https://capitalprime.notion.site/api/v3/getRecordValues", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      body: JSON.stringify(payload)
    });

    const resText = await response.text();
    if (!response.ok) {
      console.log(`❌ Failed with status ${response.status}:`, resText);
      return;
    }

    const data = JSON.parse(resText);
    console.log("🎉 Successfully fetched block values!");
    console.log(JSON.stringify(data, null, 2));

  } catch (err) {
    console.error("❌ Error:", err.message);
  }
}

main();
