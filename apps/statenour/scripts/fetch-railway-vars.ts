

async function main() {
  const token = process.env.RAILWAY_API_TOKEN;
  if (!token) {
    console.error("RAILWAY_API_TOKEN is not set in environment!");
    process.exit(1);
  }

  const projectId = "d78487fa-24c7-412e-9d2c-1055d9f8db93";
  const environmentId = "84f0d4b4-efcd-480f-a761-27589e0a095f";
  const serviceId = "c68ce7f7-63b1-47bf-9e9e-2d7dfe717d4e"; // statenour-web

  const query = `
    query GetVariables($projectId: String!, $environmentId: String!, $serviceId: String) {
      variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
    }
  `;

  try {
    const res = await fetch("https://backboard.railway.com/graphql/v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        query,
        variables: {
          projectId,
          environmentId,
          serviceId
        }
      })
    });

    const data = await res.json();
    console.log("=== Service Variables ===");
    console.log(JSON.stringify(data, null, 2));

    // Also fetch shared variables (serviceId omitted)
    const resShared = await fetch("https://backboard.railway.com/graphql/v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        query,
        variables: {
          projectId,
          environmentId
        }
      })
    });
    const dataShared = await resShared.json();
    console.log("\n=== Shared Variables ===");
    console.log(JSON.stringify(dataShared, null, 2));

  } catch (err) {
    console.error("Error fetching variables from Railway:", err);
  }
}

main();
