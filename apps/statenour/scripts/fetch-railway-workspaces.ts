

async function main() {
  const token = process.env.RAILWAY_API_TOKEN;
  if (!token) {
    console.error("RAILWAY_API_TOKEN is not set in environment!");
    process.exit(1);
  }

  const query = `
    query GetWorkspace {
      workspace {
        id
        name
        projects {
          edges {
            node {
              id
              name
              environments {
                edges {
                  node {
                    id
                    name
                  }
                }
              }
              services {
                edges {
                  node {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const res = await fetch("https://backboard.railway.com/graphql/v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ query })
    });

    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error fetching workspaces from Railway:", err);
  }
}

main();
