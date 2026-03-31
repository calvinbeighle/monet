# 04 - Local File and Git Activity Ingestion

## Topic Statement

The system reads local file activity and git repository history to understand what the user is working on, providing project context for workstream detection.

## Scope

**In-scope:** Reading git commit history, tracking recently modified files, scanning project directories for structure context.

**Boundaries:** File editing or git operations are out of scope. Workstream assignment is out of scope (see 07-workstream-detection).

## Data Contracts

### Git Commit (input)

- Commit hash
- Author name and email
- Timestamp
- Message
- Files changed (list of paths)
- Repository path

### Normalized Activity Record (output, per commit)

- Source: "git"
- Source ID: commit hash
- Timestamp: commit timestamp
- Title: first line of commit message
- Participants: [{ email: author email, displayName: author name }]
- Preview: full commit message (first 200 chars)
- Body: commit message + list of changed files
- Labels: [repository name, branch name]
- Metadata: { repoPath, branch, filesChanged[], insertions, deletions }

### Normalized Activity Record (output, per project directory)

- Source: "local-project"
- Source ID: hash of directory path
- Timestamp: most recent file modification time in directory
- Title: directory name
- Participants: []
- Preview: top-level file listing summary
- Body: null
- Labels: [parent directory name]
- Metadata: { path, fileCount, lastModified, hasPackageJson, hasGitRepo }

## Behaviors (execution order)

1. **Repository discovery**: Scan known project directories (configurable, default: `~/Monet/`) for git repositories. A directory containing a `.git` folder is a repository.

2. **Commit history**: For each discovered repository, read the git log for the past 14 days. Each commit becomes one activity record. Only commits by the current user (matched by git config email) are ingested.

3. **Branch context**: The current branch name of each repository is captured as a label. Branch names often contain project or feature context useful for workstream detection.

4. **Recently modified files**: For each repository, identify files modified in the last 7 days. Group by directory to identify active project areas. This provides finer-grained context than commit-level data.

5. **Project directory scanning**: Scan top-level project directories for structural signals: presence of package.json, README, Dockerfile, etc. This metadata helps the AI understand what kind of project each directory represents.

6. **Refresh**: Re-scan git history and file modification times every 5 minutes.

## Acceptance Criteria

- Discovers git repositories in configured directories
- Reads commit history for the past 14 days, filtered to current user
- Each commit normalized into an activity record with changed files
- Captures current branch names as labels
- Identifies recently modified files grouped by directory
- Scans project directories for structural metadata
- Refreshes every 5 minutes
