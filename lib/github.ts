import { getServerEnv } from "./env";

export async function dispatchTranscodeWorkflow(jobId: string) {
  const env = getServerEnv();
  const url = `https://api.github.com/repos/${env.githubOwner}/${env.githubRepo}/actions/workflows/${encodeURIComponent(env.githubWorkflowFile)}/dispatches`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.githubToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: env.githubRef, inputs: { job_id: jobId } }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub workflow dispatch failed (${response.status}): ${text}`);
  }
}
