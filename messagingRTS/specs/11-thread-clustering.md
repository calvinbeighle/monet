# Spec 11 - Thread Clustering

## Topic Statement

Thread clusters are dynamically formed groups of related email threads on the 2D strategy map. Clusters form automatically when two or more threads share sufficient affinity - measured by participant overlap, topic keywords, shared labels, or temporal proximity of activity. Clusters are the primary unit of agent deployment; agents operate on clusters, not individual threads. Cluster membership is not permanent: threads join and leave as their data changes, and a cluster dissolves when it no longer has enough members to justify its existence.

---

## Scope

### In Scope

- The affinity factors that qualify two or more threads for cluster membership
- How affinity is evaluated and combined into a single score that determines whether threads belong together
- The process by which threads join a cluster when they first appear on the map or when their data changes
- The process by which threads leave a cluster when affinity drops below threshold
- Cluster dissolution when member count falls below the minimum
- Cluster centroid computation from member positions
- Cluster label derivation from member subjects and participants
- Cluster extent as a function of member count
- Manual override: the user dragging a thread out of a cluster
- The constraint that a thread belongs to at most one cluster at a time
- Evaluation order and timing relative to map ticks and new thread arrivals

### Out of Scope

- Rendering of cluster boundaries, labels, and visual extent (covered in Spec 02)
- Thread positioning and drift mechanics (covered in Spec 03)
- Agent unit definitions and capacities (covered in Spec 05)
- Agent deployment mechanics and drag interactions (covered in Spec 06)
- How urgency, value, and zone assignment are computed (covered in respective specs)
- User interaction beyond dragging a thread out of a cluster (selection, opening, replying)
- Multi-user or shared map state
- Persistence of cluster identity across sessions beyond what is required to resume member sets

---

## Data Contracts

### Affinity Record

For any two threads being evaluated together, the system produces an affinity record carrying:

- The identifiers of the two threads being compared
- A participant overlap score - a normalized value reflecting the fraction of shared email addresses relative to the combined unique participant set across both threads
- A topic keyword overlap score - a normalized value reflecting the proportion of shared normalized topic tags from each thread's tag set
- A shared label score - a binary or weighted value indicating whether both threads carry one or more of the same user-applied labels
- A temporal proximity score - a normalized value reflecting how close in time the most recent activity timestamps of the two threads are, relative to a defined recency window
- A composite affinity score - a single value combining the four component scores using a fixed weighting scheme where participant overlap carries the highest weight
- A flag indicating whether the composite score meets or exceeds the clustering threshold

### Cluster Record

A cluster is a first-class entity on the map. A cluster record carries:

- A unique cluster identifier
- A list of member thread identifiers (minimum 2)
- A computed centroid position as an (x, y) coordinate pair in map space, derived from the mean of member positions
- A label string derived from the dominant common subject terms or participant names shared across members
- A visual extent value representing the spatial footprint of the cluster, which grows with member count
- A timestamp of when the cluster was formed
- A timestamp of the most recent membership change

### Thread Record (cluster-relevant fields)

Each thread record exposes the following fields consumed by the clustering system:

- A unique thread identifier
- A participant list as a set of normalized email addresses
- A topic tag set as normalized keyword strings derived from subject and body
- A set of user-applied label identifiers
- A timestamp of most recent activity (inbound or outbound message)
- A current map position as an (x, y) coordinate pair
- A cluster membership reference - either a cluster identifier or absent if the thread is unassigned

---

## Behaviors in Execution Order

### 1. Affinity Evaluation

Affinity between any two threads is evaluated whenever a triggering event occurs. Triggering events are:

- A new thread arrives on the map
- An existing thread's participant list, topic tags, labels, or most recent activity timestamp changes
- The map tick cycle completes

During evaluation, the system computes the affinity record for the candidate pair. The composite affinity score is computed by combining the four component scores with participant overlap weighted most heavily, followed by topic keyword overlap, shared labels, and temporal proximity in descending order of weight. The exact weights are a system configuration; what matters behaviorally is that no non-participant factor alone can produce a composite score that exceeds the clustering threshold.

### 2. Cluster Formation

When two threads that are currently unassigned to any cluster produce an affinity record with a composite score at or above the clustering threshold, a new cluster is created. The two threads become its founding members. The cluster record is populated immediately: centroid is computed from the two member positions, label is derived from common subject terms or participant names, and extent is set to the minimum value for a two-member cluster.

A cluster is never created with fewer than two members. An affinity score at or above threshold is required; proximity alone without threshold satisfaction does not form a cluster.

### 3. New Thread Evaluation on Map Arrival

When a thread appears on the map for the first time, the system immediately evaluates its affinity against all existing threads. This evaluation happens before the thread's position is finalized, so that position bias toward cluster members (described in Spec 03) can take effect at placement time.

If the new thread's highest composite affinity score against any existing cluster member meets or exceeds the clustering threshold, the thread is assigned to the cluster with the highest aggregate affinity match. If no existing cluster qualifies but another unassigned thread also meets the threshold, a new cluster is formed. If neither condition is met, the thread remains unassigned.

### 4. Membership Addition

A thread joins an existing cluster when:

- Its composite affinity score against one or more current members meets or exceeds the clustering threshold, and
- It is not already assigned to another cluster, or its current cluster produces a lower aggregate affinity match than the candidate cluster

When a thread joins, it is added to the cluster's member list. The centroid is recomputed from the updated member set. The label is re-derived from the updated member set. The extent is updated to reflect the new member count.

A thread that is already assigned to a cluster is not evaluated for membership in a second cluster. A thread must leave its current cluster (through data change, dissolution, or manual override) before it can join another.

### 5. Cluster Label Derivation

The cluster label is derived from the member set at formation time and recomputed on every membership change. The system identifies the terms and participant names that appear across the greatest number of member threads. The label is the shortest meaningful string that represents those dominant terms. Participant name labels are preferred when a single participant appears in all member threads. Subject keyword labels are used when no single participant spans all members. The label updates immediately when membership changes alter which terms are dominant.

### 6. Centroid and Extent Updates

After any membership change, the centroid is recomputed as the arithmetic mean of all member thread positions at the time of the change. The centroid reflects only current member positions; it does not average over historical positions. The extent grows monotonically with member count - a cluster with more members occupies a larger spatial footprint. Extent does not decrease when a member leaves unless the member count also decreases. When a member leaves and count decreases, extent contracts to the value appropriate for the remaining member count.

### 7. Membership Removal

A thread leaves its cluster when any of the following is true:

- Its participant list, topic tags, labels, or activity timestamp changes such that its composite affinity score against every remaining cluster member falls below the clustering threshold
- The map tick cycle re-evaluates the thread and confirms the affinity drop persists
- The user drags the thread out of the cluster manually (see behavior 9)

When a thread leaves, it is removed from the cluster's member list. The centroid and label are recomputed. If the cluster retains two or more members, it persists with updated values. If removing the thread leaves only one member, dissolution is triggered immediately.

### 8. Cluster Dissolution

A cluster dissolves when its member count drops below two. This occurs when:

- A thread leaves and only one member remains, or
- The last two members both simultaneously fail the affinity threshold in the same evaluation pass

On dissolution, the cluster record is removed. Any remaining member thread reverts to unassigned status. The system immediately re-evaluates the newly unassigned thread against all other threads on the map to determine whether it qualifies for membership in another cluster. If it does, it joins the best-matching existing cluster or forms a new one with another qualifying unassigned thread. If it does not, it remains unassigned.

Dissolved cluster identifiers are not reused. If the same threads reform a cluster later, a new cluster record with a new identifier is created.

### 9. Manual Override

The user can drag any thread out of its current cluster. This gesture signals an explicit rejection of the current cluster membership for that thread. On release of the drag:

- The thread is removed from its cluster's member list immediately
- The removed membership is recorded as user-overridden
- The thread is not automatically re-evaluated for membership in the same cluster from which it was just removed for the remainder of the current session
- Dissolution is triggered if the cluster falls below two members
- The thread is free to join a different cluster if affinity with another cluster's members meets the threshold; it is only blocked from rejoining the specific cluster it was just dragged out of

The override does not affect other threads in the original cluster. The original cluster persists if it retains two or more members.

### 10. Agent Deployment Target Resolution

When a user initiates agent deployment, the target is always a cluster, not an individual unassigned thread. An unassigned thread is not a valid deployment target until it is part of a cluster. The cluster's member list at the time of deployment confirmation determines the thread scope for that deployment. If cluster membership changes after deployment is confirmed but before work begins, the deployment proceeds against the member list captured at confirmation time.

---

## State Transitions

### Thread Cluster Membership States

A thread is always in exactly one of the following membership states:

- Unassigned - the thread is on the map but does not belong to any cluster; it is eligible for cluster evaluation on the next triggering event
- Pending Evaluation - a triggering event has occurred and affinity evaluation is in progress; the thread's membership state has not yet been updated; this state is transient and resolves within the same evaluation pass
- Member - the thread belongs to a cluster; it is not evaluated for other clusters while in this state
- Override-Excluded - the user has manually removed the thread from a specific cluster; the thread is unassigned and may join other clusters but not the excluded one for the current session

Transitions:

- Unassigned -> Pending Evaluation: a triggering event fires (new arrival, data change, tick)
- Pending Evaluation -> Member: evaluation finds a qualifying cluster or forms a new one
- Pending Evaluation -> Unassigned: evaluation finds no qualifying partner or cluster
- Member -> Pending Evaluation: data change triggers re-evaluation while thread is a member
- Member -> Unassigned: affinity drops below threshold for all cluster members and cluster does not dissolve with another member remaining; or cluster dissolves and re-evaluation finds no new cluster
- Member -> Override-Excluded: user drags thread out of its cluster
- Override-Excluded -> Member: thread qualifies for a different cluster (not the excluded one)
- Override-Excluded -> Unassigned: thread does not qualify for any other cluster after override

### Cluster Lifecycle States

- Forming - the system has identified two qualifying threads and is creating the cluster record; this state is transient and resolves within the same evaluation pass
- Active - the cluster has two or more members and is available as an agent deployment target; centroid, label, and extent are current
- Dissolving - a membership removal has left the cluster with fewer than two members; remaining members are being reassigned; this state is transient and resolves within the same evaluation pass
- Dissolved - the cluster no longer exists; its identifier is retired

Transitions:

- Forming -> Active: cluster record is created with two or more members
- Active -> Active: membership changes but count remains at two or more; centroid, label, and extent are recomputed
- Active -> Dissolving: membership drops below two members
- Dissolving -> Dissolved: remaining member re-evaluation is complete; cluster record is removed

---

## Acceptance Criteria

- When two threads are added to the map that share at least one participant, they are assigned to the same cluster without any user action, and the cluster appears on the map before the next user interaction.
- When two threads share only topic keywords (no shared participants), they are assigned to the same cluster only if the composite affinity score meets the clustering threshold; keyword overlap alone that falls below threshold does not produce a cluster.
- When a thread's participant list changes to remove the shared participant that formed its cluster membership, and no other affinity factor maintains the threshold, the thread leaves the cluster on the next evaluation pass.
- When a cluster member is removed and the cluster falls to one member, the cluster dissolves and the remaining thread reverts to unassigned status.
- When a cluster dissolves, the remaining thread is immediately re-evaluated against all other threads on the map; if it qualifies for another cluster, it joins before the next tick completes.
- When a new thread arrives on the map, it is evaluated for cluster membership before its starting position is finalized, so that position bias toward cluster members is applied at placement.
- When a thread belongs to one cluster, it cannot simultaneously appear as a member of a second cluster; the member list of any two clusters never contains the same thread identifier.
- When a cluster gains a new member, its centroid position updates to reflect the new mean of all member positions, including the newly added thread.
- When a cluster gains or loses members, its label reflects the dominant shared subject terms or participant names of the current member set.
- When a cluster has more members than it did at formation, its visual extent is larger than at formation; the extent does not shrink unless member count also decreases.
- When a user drags a thread out of its cluster, the thread is removed from that cluster's member list immediately and does not re-join that same cluster later in the session, even if affinity conditions are re-satisfied.
- When a user drags a thread out of a cluster and that cluster retains two or more members, the original cluster persists with the remaining members and its centroid and label update accordingly.
- When a thread is unassigned (not a member of any cluster), it is not a valid target for agent deployment; only clusters qualify as deployment targets.
- When two threads have no shared participants, no shared topic keywords, no shared labels, and activity timestamps far apart in time, they are not clustered together.
- When an agent deployment is confirmed against a cluster, and cluster membership subsequently changes before work begins, the deployment operates on the member list that existed at confirmation time.
