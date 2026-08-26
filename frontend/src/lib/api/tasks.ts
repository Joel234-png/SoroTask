export type TaskStatus = "pending" | "running" | "success" | "failed";

export interface Task {
  id: string;
  contract: string;
  fn: string;
  intervalSec: number;
  gas: number;
  status: TaskStatus;
  updatedAt: number;
}

export interface TaskFilters {
  status?: TaskStatus;
  search?: string;
}

export interface RegisterTaskInput {
  contract: string;
  fn: string;
  intervalSec: number;
  gas: number;
}

export interface UpdateTaskInput {
  id: string;
  intervalSec?: number;
  gas?: number;
}

const GRAPHQL_URL = process.env.NEXT_PUBLIC_INDEXER_URL || "http://localhost:4000/graphql";

async function fetchGraphQL(query: string, variables: any = {}) {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Add authentication headers here if needed based on GRAPHQL.md
    },
    body: JSON.stringify({ query, variables }),
  });

  const result = await response.json();
  if (result.errors) {
    throw new Error(result.errors[0].message);
  }
  return result.data;
}

// Map the GraphQL response to the frontend's Task model
function mapTask(gqlTask: any): Task {
  return {
    id: gqlTask.id || gqlTask.task_id?.toString() || "0",
    contract: gqlTask.target || gqlTask.contract_id || "Unknown",
    fn: gqlTask.function || "Unknown",
    intervalSec: gqlTask.interval || 0,
    gas: parseFloat(gqlTask.gas_balance || "0"),
    status: gqlTask.is_active ? "success" : "pending",
    updatedAt: new Date(gqlTask.updated_at || Date.now()).getTime(),
  };
}

export async function listTasks(filters: TaskFilters = {}): Promise<Task[]> {
  const query = `
    query GetTasks {
      tasks(limit: 100) {
        task_id
        target
        function
        interval
        gas_balance
        is_active
        updated_at
      }
    }
  `;
  
  try {
    const data = await fetchGraphQL(query);
    let result = (data.tasks || []).map(mapTask);

    if (filters.status) {
      result = result.filter((t: Task) => t.status === filters.status);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (t: Task) =>
          t.fn.toLowerCase().includes(q) ||
          t.contract.toLowerCase().includes(q),
      );
    }
    
    return result.sort((a: Task, b: Task) => a.id.localeCompare(b.id));
  } catch (err) {
    console.error("Failed to list tasks from indexer, returning empty.", err);
    return [];
  }
}

export async function getTask(id: string): Promise<Task> {
  const query = `
    query GetTask($id: ID!) {
      task(id: $id) {
        task_id
        target
        function
        interval
        gas_balance
        is_active
        updated_at
      }
    }
  `;
  
  const data = await fetchGraphQL(query, { id });
  if (!data.task) {
    throw new Error(`Task ${id} not found`);
  }
  return mapTask(data.task);
}

// Mutations
// Note: Since proper registration/update requires Soroban transactions via freighter,
// these are currently mocked endpoints so the UI remains functional without a connected wallet.

export async function registerTask(input: RegisterTaskInput): Promise<Task> {
  console.log("Mocking registerTask until Soroban transaction is implemented", input);
  return {
    id: `task-${Date.now()}`,
    contract: input.contract,
    fn: input.fn,
    intervalSec: input.intervalSec,
    gas: input.gas,
    status: "pending",
    updatedAt: Date.now(),
  };
}

export async function updateTask(input: UpdateTaskInput): Promise<Task> {
  console.log("Mocking updateTask until Soroban transaction is implemented", input);
  return {
    id: input.id,
    contract: "CXYZ",
    fn: "mocked_update",
    intervalSec: input.intervalSec || 0,
    gas: input.gas || 0,
    status: "success",
    updatedAt: Date.now(),
  };
}

export async function deleteTask(id: string): Promise<{ id: string }> {
  // Use pauseTask from GraphQL as a substitute for deletion
  const mutation = `
    mutation PauseTask($id: ID!) {
      pauseTask(id: $id) {
        task_id
      }
    }
  `;
  
  try {
    await fetchGraphQL(mutation, { id });
  } catch (err) {
    console.error("Failed to pause/delete task via GraphQL:", err);
  }
  return { id };
}
