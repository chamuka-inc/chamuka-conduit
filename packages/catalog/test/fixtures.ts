// A structurally valid raw action used across the catalog tests. Tests clone and mutate it to
// produce the specific malformed variants they assert on, so each test states exactly one defect.

export function validRawAction(): Record<string, unknown> {
  return {
    name: 'github.create_issue',
    provider: 'github',
    description: 'Create an issue in a repository.',
    providerHosts: ['api.github.com'],
    inputSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['owner', 'repo', 'title'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: { number: { type: 'integer' }, htmlUrl: { type: 'string' } },
    },
    request: {
      method: 'POST',
      urlTemplate: 'https://api.github.com/repos/{owner}/{repo}/issues',
      headers: { Accept: 'application/vnd.github+json' },
      body: { title: '{title}', body: '{body}' },
    },
    normalize: { number: 'number', htmlUrl: 'html_url' },
  }
}
