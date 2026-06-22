export function getLeadContext(data, lead, normalizeForMatch) {
  const companyKey = normalizeForMatch(lead?.company);
  const leadNameKey = normalizeForMatch(lead?.name);
  const hasCompany = Boolean(companyKey);
  const hasLeadName = Boolean(leadNameKey);

  const account = (data.accounts || []).find((item) => normalizeForMatch(item.name) === companyKey) || null;

  const contacts = (data.contacts || []).filter((contact) => {
    const contactNameKey = normalizeForMatch(contact.name);
    const contactAccountKey = normalizeForMatch(contact.account);
    return (hasLeadName && contactNameKey === leadNameKey) || (hasCompany && contactAccountKey === companyKey);
  });

  const deals = (data.deals || []).filter((deal) => {
    const dealAccountKey = normalizeForMatch(deal.account);
    return hasCompany && dealAccountKey === companyKey;
  });

  const linkedTasks = (data.tasks || []).filter((task) => {
    const linkType = normalizeForMatch(task.linkType);
    const linkLabel = normalizeForMatch(task.linkLabel);
    const taskTitle = normalizeForMatch(task.title);
    if (linkType === "lead" && hasLeadName && linkLabel.includes(leadNameKey)) {
      return true;
    }
    return hasLeadName && taskTitle.includes(leadNameKey);
  });

  const activity = (data.activityLog || [])
    .filter((entry) => {
      const entryLeadId = String(entry.leadId || "").trim();
      const entryLeadName = String(entry.leadName || "").trim().toLowerCase();
      const leadId = String(lead.id || "").trim();
      const leadName = String(lead.name || "").trim().toLowerCase();
      if (entryLeadId && entryLeadId === leadId) {
        return true;
      }
      if (!entryLeadId && entryLeadName && entryLeadName === leadName) {
        return true;
      }
      return false;
    })
    .sort((a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || "")))
    .slice(0, 12)
    .map((entry) => {
      const type = String(entry.type || "").toLowerCase();
      if (type === "lead-converted") {
        return {
          label: "Lead converted",
          text: "Converted to account/contact/deal.",
          createdAt: entry.createdAt,
          actor: entry.actor || ""
        };
      }
      if (type === "lead-note") {
        return {
          label: "Note added",
          text: String(entry.text || "").trim() || "No details.",
          createdAt: entry.createdAt,
          actor: entry.actor || ""
        };
      }
      if (type === "lead-followup-updated") {
        return {
          label: "Follow-up updated",
          text: String(entry.text || "").trim() || "Follow-up date changed.",
          createdAt: entry.createdAt,
          actor: entry.actor || ""
        };
      }
      if (type === "lead-owner-reassigned") {
        return {
          label: "Owner reassigned",
          text: String(entry.text || "").trim() || "Owner changed.",
          createdAt: entry.createdAt,
          actor: entry.actor || ""
        };
      }
      if (type === "lead-attempt-logged") {
        return {
          label: "Attempt logged",
          text: String(entry.text || "").trim() || "Outreach attempt logged.",
          createdAt: entry.createdAt,
          actor: entry.actor || ""
        };
      }
      if (type === "lead-archived") {
        return {
          label: "Lead archived",
          text: String(entry.text || "").trim() || "Lead moved to archive.",
          createdAt: entry.createdAt,
          actor: entry.actor || ""
        };
      }
      return {
        label: "Activity",
        text: String(entry.text || "").trim() || "Updated",
        createdAt: entry.createdAt,
        actor: entry.actor || ""
      };
    });

  return { account, contacts, deals, linkedTasks, activity };
}

export function getPrimaryLeadContact(lead, context = null, getLeadContextFn = null) {
  const source = context || (typeof getLeadContextFn === "function" ? getLeadContextFn(lead) : null) || {
    contacts: []
  };
  if (!source.contacts.length) {
    return null;
  }
  return (
    source.contacts.find((contact) => String(contact.email || "").trim() || String(contact.phone || "").trim()) ||
    source.contacts[0]
  );
}

export function getPrimaryAccountContact(data, account, options, normalizeForMatch, normalizePhoneValue) {
  if (!account) {
    return null;
  }
  const requireEmail = Boolean(options?.requireEmail);
  const requirePhone = Boolean(options?.requirePhone);
  const accountKey = normalizeForMatch(account.name);
  if (!accountKey) {
    return null;
  }
  const contacts = (data.contacts || []).filter((contact) => normalizeForMatch(contact.account) === accountKey);
  if (!contacts.length) {
    return null;
  }
  const meetsChannel = (contact) => {
    const hasEmail = Boolean(String(contact.email || "").trim());
    const hasPhone = Boolean(normalizePhoneValue(contact.phone || ""));
    if (requireEmail && !hasEmail) {
      return false;
    }
    if (requirePhone && !hasPhone) {
      return false;
    }
    return true;
  };
  return (
    contacts.find(meetsChannel) ||
    contacts.find((contact) => String(contact.email || "").trim() || normalizePhoneValue(contact.phone || "")) ||
    contacts[0]
  );
}

export function getContactContext(
  data,
  contact,
  { normalizeForMatch, normalizePhoneValue, parseIsoDateLocal, formatDealMoney, findDirectThreadByName }
) {
  if (!contact) {
    return {
      account: null,
      leads: [],
      deals: [],
      linkedTasks: [],
      directThread: null,
      commMessages: [],
      activity: [],
      nextFollowUp: ""
    };
  }

  const contactId = String(contact.id || "").trim();
  const contactNameKey = normalizeForMatch(contact.name);
  const accountKey = normalizeForMatch(contact.account);
  const account = (data.accounts || []).find((item) => normalizeForMatch(item.name) === accountKey) || null;

  const leads = (data.leads || [])
    .filter((lead) => !lead.archived && String(lead.status || "").trim() !== "Archived")
    .filter((lead) => {
      const leadNameKey = normalizeForMatch(lead.name);
      const leadCompanyKey = normalizeForMatch(lead.company);
      if (contactNameKey && leadNameKey === contactNameKey) {
        return true;
      }
      return Boolean(accountKey) && leadCompanyKey === accountKey;
    });

  const deals = (data.deals || []).filter((deal) => normalizeForMatch(deal.account) === accountKey);

  const linkedTasks = (data.tasks || [])
    .filter((task) => {
      const linkType = normalizeForMatch(task.linkType);
      const linkId = String(task.linkId || "").trim();
      const linkLabel = normalizeForMatch(task.linkLabel);
      const titleKey = normalizeForMatch(task.title);
      const taskAccountKey = normalizeForMatch(task.account || task.accountName);
      if (linkType === "contact" && ((contactId && linkId === contactId) || (contactNameKey && linkLabel.includes(contactNameKey)))) {
        return true;
      }
      if (accountKey && taskAccountKey === accountKey) {
        return true;
      }
      return Boolean(contactNameKey) && titleKey.includes(contactNameKey);
    })
    .sort((a, b) => Date.parse(String(b.updatedAt || b.createdAt || "")) - Date.parse(String(a.updatedAt || a.createdAt || "")));

  const directThread = findDirectThreadByName(contact.name);
  const commMessages = (data.messages || [])
    .filter((message) => {
      if (directThread && message.targetType === "direct" && message.targetId === directThread.id) {
        return true;
      }
      const linkedType = normalizeForMatch(message.linkedType);
      const linkedLabel = normalizeForMatch(message.linkedLabel);
      if (linkedType === "contact" && contactNameKey && linkedLabel.includes(contactNameKey)) {
        return true;
      }
      return linkedType === "account" && accountKey && linkedLabel.includes(accountKey);
    })
    .sort((a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || "")));

  const taskActivity = linkedTasks.map((task) => ({
    label: `Task ${String(task.status || "New")}`,
    text: String(task.title || "Task updated"),
    actor: String(task.assignee || "").trim() || "System",
    createdAt: String(task.updatedAt || task.createdAt || "")
  }));

  const dealActivity = deals.map((deal) => ({
    label: `Deal ${String(deal.stage || "Prospecting")}`,
    text: `${deal.name || "Deal"} (${formatDealMoney(Number(deal.value || 0))})`,
    actor: String(deal.owner || "").trim() || "System",
    createdAt: String(deal.updatedAt || deal.createdAt || "")
  }));

  const commActivity = commMessages.map((message) => ({
    label: String(message.messageType || "Message"),
    text: String(message.text || "").trim() || "Message posted.",
    actor: String(message.sender || "").trim() || "System",
    createdAt: String(message.createdAt || "")
  }));

  const profileActivity = [];
  if (String(contact.updatedAt || "").trim()) {
    profileActivity.push({
      label: "Contact updated",
      text: "Details were updated.",
      actor: String(contact.owner || "").trim() || "System",
      createdAt: String(contact.updatedAt || "")
    });
  }
  if (String(contact.createdAt || "").trim()) {
    profileActivity.push({
      label: "Contact created",
      text: "Contact record created.",
      actor: String(contact.owner || "").trim() || "System",
      createdAt: String(contact.createdAt || "")
    });
  }

  const activity = [...profileActivity, ...commActivity, ...taskActivity, ...dealActivity]
    .filter((item) => Number.isFinite(Date.parse(String(item.createdAt || ""))))
    .sort((a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || "")))
    .slice(0, 16);

  const nextFollowUp =
    linkedTasks
      .filter((task) => String(task.status || "").trim() !== "Completed")
      .map((task) => String(task.dueDate || "").trim())
      .filter((dueDate) => parseIsoDateLocal(dueDate))
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0] || "";

  return { account, leads, deals, linkedTasks, directThread, commMessages, activity, nextFollowUp };
}

export function getContactRelatedCrmConversations(
  data,
  contact,
  options = {},
  { normalizeForMatch, ensureCrmConversationForRecord }
) {
  if (!contact) {
    return [];
  }
  const createIfMissing = Boolean(options.createIfMissing);
  const normalizedName = normalizeForMatch(contact.name);
  const normalizedAccount = normalizeForMatch(contact.account);
  const conversations = [];

  const openDeals = (data.deals || [])
    .filter((deal) => normalizeForMatch(deal.account) === normalizedAccount)
    .sort((left, right) => Date.parse(String(left.closeDate || "")) - Date.parse(String(right.closeDate || "")));
  openDeals.forEach((deal) => {
    const conversation = ensureCrmConversationForRecord("deal", deal, createIfMissing);
    if (conversation) {
      conversations.push(conversation);
    }
  });

  const account = (data.accounts || []).find((item) => normalizeForMatch(item.name) === normalizedAccount) || null;
  if (account) {
    const conversation = ensureCrmConversationForRecord("account", account, createIfMissing);
    if (conversation) {
      conversations.push(conversation);
    }
  }

  const leads = (data.leads || []).filter(
    (lead) => normalizeForMatch(lead.name) === normalizedName || normalizeForMatch(lead.company) === normalizedAccount
  );
  leads.forEach((lead) => {
    const conversation = ensureCrmConversationForRecord("lead", lead, createIfMissing);
    if (conversation) {
      conversations.push(conversation);
    }
  });

  return conversations.filter(
    (conversation, index, items) => items.findIndex((candidate) => candidate.id === conversation.id) === index
  );
}
