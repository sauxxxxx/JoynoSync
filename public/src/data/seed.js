const seedNow = new Date();
const seedToday = seedNow.toISOString().slice(0, 10);

function seedTodayAt(hours, minutes) {
  const date = new Date(seedNow);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

export const seedData = {
  currentUser: {
    id: "u_01",
    name: "Joy N.",
    role: "Owner",
    email: "joy@joyno.example",
    phone: "+1-555-0100",
    title: "Leadership | Owner",
    timezone: "Asia/Shanghai",
    language: "English",
    availability: "Online",
    communication: {
      senderName: "Joy N.",
      signature: "Best,\nJoy N.\nLeadership | Owner"
    },
    notifications: {
      inApp: true,
      email: true,
      sms: false
    },
    security: {
      activeSessions: 1,
      lastPasswordChange: "",
      twoFactorRequired: false
    }
  },
  workspace: {
    id: "ws_demo",
    name: "Joynosync",
    legalName: "Joynosync LLC",
    logoUrl: "",
    brandColor: "#2f68df",
    appLabel: "Joynosync",
    timezone: "Asia/Shanghai",
    dateFormat: "YYYY-MM-DD",
    currency: "USD",
    weekStart: "Mon",
    businessStart: "09:00",
    businessEnd: "18:00",
    businessDays: [1, 2, 3, 4, 5],
    crmDefaultStage: "Prospecting",
    crmDefaultOwner: "Joy N.",
    crmSlaHours: 24
  },
  teams: [
    { id: "team_sales", name: "Sales" },
    { id: "team_ops", name: "Operations" }
  ],
  teamMembers: [
    {
      id: "member_01",
      name: "Joy N.",
      email: "joy@joyno.example",
      team: "Leadership",
      role: "Owner",
      workload: 58,
      status: "Active",
      title: "Leadership | Owner",
      manager: "",
      timezone: "Asia/Shanghai",
      shift: "09:00-18:00",
      scope: "all",
      queueEligible: true,
      defaultOwner: true
    },
    {
      id: "member_02",
      name: "Nadia Stone",
      email: "nadia@joyno.example",
      team: "Sales",
      role: "Manager",
      workload: 74,
      status: "Active",
      title: "Sales | Manager",
      manager: "Joy N.",
      timezone: "Asia/Shanghai",
      shift: "09:00-18:00",
      scope: "team",
      queueEligible: true,
      defaultOwner: true
    },
    {
      id: "member_03",
      name: "Ken Li",
      email: "ken@joyno.example",
      team: "Sales",
      role: "Member",
      workload: 63,
      status: "Active",
      title: "Sales | Member",
      manager: "Nadia Stone",
      timezone: "Asia/Shanghai",
      shift: "09:00-18:00",
      scope: "own",
      queueEligible: true,
      defaultOwner: false
    },
    {
      id: "member_04",
      name: "Sven Muller",
      email: "sven@joyno.example",
      team: "Operations",
      role: "Member",
      workload: 49,
      status: "Active",
      title: "Operations | Member",
      manager: "Joy N.",
      timezone: "Asia/Shanghai",
      shift: "09:00-18:00",
      scope: "own",
      queueEligible: true,
      defaultOwner: false
    }
  ],
  metrics: {
    openDeals: 14,
    pipelineValue: 482000,
    tasksDueThisWeek: 27,
    meetingsBooked: 11
  },
  attendancePolicy: {
    shiftStart: "09:00",
    shiftEnd: "18:00",
    graceMinutes: 10,
    breakMinutes: 60,
    breakTypes: [
      {
        id: "morning",
        label: "Morning Break",
        durationMinutes: 15,
        paid: true,
        maxPerDay: 1,
        minPerDay: 0,
        required: false,
        windowStart: "09:30",
        windowEnd: "11:30"
      },
      {
        id: "lunch",
        label: "Lunch Break",
        durationMinutes: 60,
        paid: false,
        maxPerDay: 1,
        minPerDay: 1,
        required: true,
        windowStart: "11:30",
        windowEnd: "14:30"
      },
      {
        id: "afternoon",
        label: "Afternoon Break",
        durationMinutes: 15,
        paid: true,
        maxPerDay: 1,
        minPerDay: 0,
        required: false,
        windowStart: "14:30",
        windowEnd: "17:30"
      }
    ],
    workDays: [1, 2, 3, 4, 5],
    timezone: "Local"
  },
  attendanceLogs: [
    {
      id: "att_01",
      userId: "u_01",
      userName: "Joy N.",
      date: seedToday,
      clockInAt: seedTodayAt(8, 58),
      clockOutAt: seedTodayAt(17, 41),
      breaks: [
        {
          id: "brk_01",
          breakTypeId: "morning",
          breakTypeLabel: "Morning Break",
          paid: true,
          startAt: seedTodayAt(10, 31),
          endAt: seedTodayAt(10, 44)
        },
        {
          id: "brk_02",
          breakTypeId: "lunch",
          breakTypeLabel: "Lunch Break",
          paid: false,
          startAt: seedTodayAt(12, 5),
          endAt: seedTodayAt(12, 58)
        },
        {
          id: "brk_03",
          breakTypeId: "afternoon",
          breakTypeLabel: "Afternoon Break",
          paid: true,
          startAt: seedTodayAt(15, 37),
          endAt: seedTodayAt(15, 50)
        }
      ],
      source: "manual",
      createdAt: seedTodayAt(8, 58),
      updatedAt: seedTodayAt(17, 41)
    },
    {
      id: "att_02",
      userId: "member_02",
      userName: "Nadia Stone",
      date: seedToday,
      clockInAt: seedTodayAt(9, 22),
      clockOutAt: "",
      breaks: [
        {
          id: "brk_04",
          breakTypeId: "lunch",
          breakTypeLabel: "Lunch Break",
          paid: false,
          startAt: seedTodayAt(13, 15),
          endAt: ""
        }
      ],
      source: "manual",
      createdAt: seedTodayAt(9, 22),
      updatedAt: seedTodayAt(13, 15)
    },
    {
      id: "att_03",
      userId: "member_04",
      userName: "Sven Muller",
      date: seedToday,
      clockInAt: seedTodayAt(8, 55),
      clockOutAt: "",
      breaks: [],
      source: "manual",
      createdAt: seedTodayAt(8, 55),
      updatedAt: seedTodayAt(8, 55)
    }
  ],
  attendanceRequests: [
    {
      id: "attreq_01",
      userId: "member_03",
      userName: "Ken Li",
      date: seedToday,
      type: "Missing Clock In",
      reason: "Phone app crashed during morning punch.",
      status: "Pending",
      createdAt: seedTodayAt(10, 12),
      reviewedBy: "",
      reviewedAt: ""
    }
  ],
  tasks: [
    {
      id: "task_01",
      title: "Qualify ACME inbound lead",
      assignee: "Nadia",
      day: "Mon",
      time: "09:00 - 10:00",
      status: "In progress",
      priority: "high"
    },
    {
      id: "task_02",
      title: "Proposal draft for Northstar deal",
      assignee: "Ken",
      day: "Mon",
      time: "11:00 - 12:00",
      status: "Scheduled",
      priority: "medium"
    },
    {
      id: "task_03",
      title: "Account kickoff with Bloom Labs",
      assignee: "Nadia",
      day: "Tue",
      time: "10:00 - 11:00",
      status: "Scheduled",
      priority: "low"
    },
    {
      id: "task_04",
      title: "Follow-up on legal redlines",
      assignee: "Sven",
      day: "Wed",
      time: "14:00 - 14:30",
      status: "New",
      priority: "medium"
    },
    {
      id: "task_05",
      title: "Renewal call with Orbit Freight",
      assignee: "Ken",
      day: "Thu",
      time: "16:00 - 16:45",
      status: "In progress",
      priority: "high"
    },
    {
      id: "task_06",
      title: "Clean up stale leads",
      assignee: "Sven",
      day: "Fri",
      time: "13:00 - 14:00",
      status: "Completed",
      priority: "low"
    }
  ],
  waitingList: [
    {
      id: "wait_01",
      title: "Draft Q2 pipeline plan",
      owner: "Ken",
      linkedType: "Deal"
    },
    {
      id: "wait_02",
      title: "Re-engage dormant fintech leads",
      owner: "Nadia",
      linkedType: "Lead"
    },
    {
      id: "wait_03",
      title: "Create onboarding template",
      owner: "Sven",
      linkedType: "Project"
    }
  ],
  callLogs: [],
  voicemails: [],
  callQueues: [],
  agentPresence: {},
  telephonyIdentity: {},
  projects: [
    {
      id: "proj_01",
      name: "Enterprise Rollout",
      owner: "Nadia",
      progress: 62,
      status: "On Track"
    },
    {
      id: "proj_02",
      name: "Sales Process Refresh",
      owner: "Ken",
      progress: 38,
      status: "Needs Focus"
    },
    {
      id: "proj_03",
      name: "CS Handoff Framework",
      owner: "Sven",
      progress: 74,
      status: "On Track"
    }
  ],
  leads: [
    {
      id: "lead_1001",
      name: "Morgan Hill",
      company: "ACME Components",
      source: "Inbound",
      status: "New",
      owner: "Nadia",
      nextFollowUp: "2026-03-03"
    },
    {
      id: "lead_1002",
      crmConversationId: "crmconv_01",
      name: "Janelle Cruz",
      company: "Blue Pine Foods",
      source: "Referral",
      status: "Qualified",
      owner: "Ken",
      nextFollowUp: "2026-03-04"
    },
    {
      id: "lead_1003",
      name: "Arif Patel",
      company: "Northstar Robotics",
      source: "Outbound",
      status: "Contacted",
      owner: "Sven",
      nextFollowUp: "2026-03-05"
    }
  ],
  accounts: [
    {
      id: "acct_2001",
      name: "Bloom Labs",
      industry: "Biotech",
      owner: "Nadia",
      openDeals: 2,
      health: "Healthy"
    },
    {
      id: "acct_2002",
      name: "Orbit Freight",
      industry: "Logistics",
      owner: "Ken",
      openDeals: 1,
      health: "At Risk"
    },
    {
      id: "acct_2003",
      crmConversationId: "crmconv_02",
      name: "Northstar Robotics",
      industry: "Manufacturing",
      owner: "Sven",
      openDeals: 3,
      health: "Growing"
    }
  ],
  contacts: [
    {
      id: "cont_4001",
      name: "Morgan Hill",
      email: "morgan@acmecomponents.com",
      phone: "+1-415-555-0101",
      account: "ACME Components",
      role: "Ops Director",
      owner: "Nadia"
    },
    {
      id: "cont_4002",
      name: "Janelle Cruz",
      email: "janelle@bluepinefoods.com",
      phone: "+1-415-555-0112",
      account: "Blue Pine Foods",
      role: "VP Revenue",
      owner: "Ken"
    },
    {
      id: "cont_4003",
      name: "Arif Patel",
      email: "arif@northstarrobotics.com",
      phone: "+1-415-555-0123",
      account: "Northstar Robotics",
      role: "Procurement Lead",
      owner: "Sven"
    }
  ],
  deals: [
    {
      id: "deal_3001",
      name: "ACME Annual Platform",
      account: "ACME Components",
      stage: "Prospecting",
      value: 45000,
      closeDate: "2026-03-28",
      owner: "Nadia"
    },
    {
      id: "deal_3002",
      crmConversationId: "crmconv_03",
      name: "Northstar Multi-site",
      account: "Northstar Robotics",
      stage: "Qualified",
      value: 125000,
      closeDate: "2026-04-15",
      owner: "Sven"
    },
    {
      id: "deal_3003",
      name: "Bloom Labs Expansion",
      account: "Bloom Labs",
      stage: "Proposal",
      value: 98000,
      closeDate: "2026-03-21",
      owner: "Nadia"
    },
    {
      id: "deal_3004",
      name: "Orbit Freight Renewal",
      account: "Orbit Freight",
      stage: "Negotiation",
      value: 64000,
      closeDate: "2026-03-18",
      owner: "Ken"
    },
    {
      id: "deal_3005",
      name: "Atlas Foods Rollout",
      account: "Atlas Foods",
      stage: "Won",
      value: 150000,
      closeDate: "2026-02-25",
      owner: "Ken"
    }
  ],
  channels: [
    {
      id: "chan_01",
      name: "General",
      type: "Team",
      topic: "Company-wide updates and weekly check-ins",
      unread: 1,
      pinned: true,
      muted: false
    },
    {
      id: "chan_02",
      name: "Sales War Room",
      type: "Team",
      topic: "Live deal coordination and objections handling",
      unread: 3,
      pinned: true,
      muted: false
    }
  ],
  crmConversations: [
    {
      id: "crmconv_01",
      entityType: "lead",
      entityId: "lead_1002",
      title: "Janelle Cruz",
      accountId: "",
      accountName: "Blue Pine Foods",
      owner: "Ken",
      status: "active",
      unread: 1,
      pinned: false,
      muted: false,
      createdAt: "2026-03-02T08:48:00.000Z",
      updatedAt: "2026-03-02T09:26:00.000Z"
    },
    {
      id: "crmconv_02",
      entityType: "account",
      entityId: "acct_2003",
      title: "Northstar Robotics",
      accountId: "acct_2003",
      accountName: "Northstar Robotics",
      owner: "Sven",
      status: "active",
      unread: 0,
      pinned: false,
      muted: false,
      createdAt: "2026-03-02T08:55:00.000Z",
      updatedAt: "2026-03-02T09:45:00.000Z"
    },
    {
      id: "crmconv_03",
      entityType: "deal",
      entityId: "deal_3002",
      title: "Northstar Multi-site",
      accountId: "acct_2003",
      accountName: "Northstar Robotics",
      owner: "Sven",
      status: "active",
      unread: 2,
      pinned: true,
      muted: false,
      createdAt: "2026-03-02T08:58:00.000Z",
      updatedAt: "2026-03-02T09:45:00.000Z"
    }
  ],
  directThreads: [
    {
      id: "dm_01",
      name: "Nadia Stone",
      members: ["Joy N.", "Nadia Stone"],
      unread: 1,
      pinned: false,
      muted: false
    },
    {
      id: "dm_02",
      name: "Ken Li",
      members: ["Joy N.", "Ken Li"],
      unread: 0,
      pinned: false,
      muted: false
    },
    {
      id: "dm_03",
      name: "Sven Muller",
      members: ["Joy N.", "Sven Muller"],
      unread: 2,
      pinned: false,
      muted: true
    }
  ],
  messages: [
    {
      id: "msg_5001",
      targetType: "channel",
      targetId: "chan_01",
      sender: "Joy N.",
      text: "Reminder: update Monday priorities before standup.",
      messageType: "Announcement",
      important: true,
      linkedType: "Task",
      linkedLabel: "Weekly Planner",
      createdAt: "2026-03-02T08:30:00.000Z"
    },
    {
      id: "msg_5002",
      targetType: "channel",
      targetId: "chan_02",
      sender: "Nadia",
      text: "Northstar asked for revised rollout timeline. Need draft by 4 PM.",
      messageType: "Blocker",
      important: true,
      linkedType: "Deal",
      linkedLabel: "Northstar Multi-site",
      createdAt: "2026-03-02T09:00:00.000Z"
    },
    {
      id: "msg_5003",
      targetType: "channel",
      targetId: "chan_02",
      sender: "Ken",
      text: "I will push a draft proposal with legal notes.",
      messageType: "Update",
      important: false,
      linkedType: "Deal",
      linkedLabel: "Northstar Multi-site",
      createdAt: "2026-03-02T09:12:00.000Z"
    },
    {
      id: "msg_5004",
      targetType: "crm",
      targetId: "crmconv_03",
      sender: "Sven",
      text: "Northstar security questionnaire is approved.",
      messageType: "Update",
      important: false,
      linkedType: "Deal",
      linkedLabel: "Northstar Multi-site",
      createdAt: "2026-03-02T09:45:00.000Z"
    },
    {
      id: "msg_5004b",
      targetType: "crm",
      targetId: "crmconv_02",
      sender: "Sven",
      text: "Arif confirmed procurement review is still on schedule for Thursday.",
      messageType: "Update",
      important: false,
      linkedType: "Account",
      linkedLabel: "Northstar Robotics",
      createdAt: "2026-03-02T09:19:00.000Z"
    },
    {
      id: "msg_5004c",
      targetType: "crm",
      targetId: "crmconv_01",
      sender: "Ken",
      text: "Shared qualification notes before tomorrow follow-up.",
      messageType: "Announcement",
      important: false,
      linkedType: "Lead",
      linkedLabel: "Janelle Cruz",
      createdAt: "2026-03-02T09:26:00.000Z"
    },
    {
      id: "msg_5005",
      targetType: "direct",
      targetId: "dm_01",
      sender: "Nadia",
      text: "Can you review the revised discount ladder before lunch?",
      messageType: "Question",
      important: false,
      linkedType: "Account",
      linkedLabel: "Bloom Labs",
      createdAt: "2026-03-02T09:54:00.000Z"
    },
    {
      id: "msg_5006",
      targetType: "direct",
      targetId: "dm_03",
      sender: "Sven",
      text: "I need final approval on the implementation timeline.",
      messageType: "Question",
      important: true,
      linkedType: "Project",
      linkedLabel: "Enterprise Rollout",
      createdAt: "2026-03-02T10:05:00.000Z"
    },
    {
      id: "msg_5007",
      targetType: "direct",
      targetId: "dm_03",
      sender: "Joy N.",
      text: "Approved. Share the final version in Sales War Room after posting.",
      messageType: "Update",
      important: false,
      linkedType: "Project",
      linkedLabel: "Enterprise Rollout",
      createdAt: "2026-03-02T10:14:00.000Z"
    }
  ]
};
