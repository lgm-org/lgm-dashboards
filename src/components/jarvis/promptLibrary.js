// Jarvis prompt library — John's eight categories (2026-10-08).
export const PROMPT_LIBRARY = [
  {
    id: 'coaching', icon: '🎯', title: 'Employee Coaching', color: '#8CC63F',
    goal: 'Identify coaching opportunities and improve employee performance.',
    prompts: [
      "Compare Olivia's last 10 onboarding meetings against our official onboarding agenda. Identify missed steps, inconsistencies, and recommendations to improve her meetings.",
      "Compare Rachel's and Olivia's customer meetings. What does each person do particularly well, and what could they learn from one another?",
      'Which employees consistently fail to establish clear next steps or follow-up commitments during meetings?',
      "Review Kevin's last 20 sales calls. What objections does he struggle with most, and how can we coach him?",
      'Which team members have improved their communication and meeting effectiveness over the past 30 days?',
    ],
  },
  {
    id: 'training', icon: '📚', title: 'Training Opportunities', color: '#3B82F6',
    goal: 'Turn repetitive customer questions into scalable training.',
    prompts: [
      'Analyze all customer calls and meetings from the past 30 days. What are the 10 most frequently repeated questions, and which should become weekly workshops? Quantify each: number of conversations, time spent, and whether the trend is increasing.',
      'Which customer questions are consuming the most support and onboarding time?',
      'What topics do customers consistently misunderstand even after receiving training?',
      'Based on recent conversations, what three workshops should we host next month to reduce support tickets?',
      'What questions about Leadflow AI, dashboards, phone systems, and automations should be answered in new training videos?',
    ],
  },
  {
    id: 'risk', icon: '🛟', title: 'Customer Risk', color: '#FF6112',
    goal: 'Detect dissatisfaction before customers cancel.',
    prompts: [
      'Which customers have expressed frustration, dissatisfaction, or concerns about Little Giant during the past 30 days?',
      'Identify customers who mentioned cancelling, pricing concerns, or switching CRM providers.',
      'Which customers have repeatedly contacted support about the same unresolved problem?',
      'Which customer relationships have improved or deteriorated based on their recent conversations?',
      'Create a prioritized list of at-risk customers, explain the evidence, and recommend who should contact them today.',
    ],
  },
  {
    id: 'revenue', icon: '💰', title: 'Revenue Opportunities', color: '#16A34A',
    goal: 'Turn conversation intelligence into more MRR.',
    prompts: [
      'Which customers have expressed interest in AI products, additional users, dashboards, or other Little Giant upgrades?',
      "Review our sales calls from the past 30 days. What are the five most common reasons prospects don't sign up?",
      "Compare Joe's and Kevin's successful sales calls. What approaches consistently lead to stronger buying signals?",
      'Which customers mentioned a business problem that one of our existing paid products could solve?',
      'What product features are prospects requesting that could create new recurring revenue?',
    ],
  },
  {
    id: 'accountability', icon: '✅', title: 'Accountability', color: '#8B5CF6',
    goal: 'Stop commitments from disappearing after meetings.',
    prompts: [
      'What commitments did our team make to customers last week that have not been confirmed as completed?',
      'Which action items from our leadership meetings have been repeatedly discussed without resolution?',
      'Summarize everything Kylie committed to completing during the past two weeks, including deadlines and follow-up status.',
      'Which customer issues have been escalated multiple times without a documented resolution?',
      'Prepare our next Leadership L10 Issues List based on recurring problems, missed commitments, and unresolved decisions.',
    ],
  },
  {
    id: 'operations', icon: '⚙️', title: 'Operations', color: '#0EA5E9',
    goal: 'Find inefficiencies and opportunities for automation.',
    prompts: [
      'What repetitive manual tasks are employees discussing that we could automate?',
      'Analyze our onboarding calls. Where do we consistently waste time or create confusion for new customers?',
      'What issues are being transferred between Support, Customer Relations, and Operations instead of being resolved by the first person?',
      'Which internal processes generate the most repeat conversations and follow-up meetings?',
      'What three operational improvements would save our team the most time each week?',
    ],
  },
  {
    id: 'product', icon: '🧩', title: 'Development Ideas', color: '#EAB308',
    goal: 'Help Syed and Steve build what customers actually need.',
    prompts: [
      'What are the 10 most requested Little Giant features from customer conversations over the past 60 days?',
      'Which product problems are costing us the most support time or creating cancellation risk?',
      'Based on customer feedback, what should Syed and Steve prioritize in our next two-week development sprint?',
      'What are customers saying about our Goals Dashboard, Daily Recap, and AI products?',
      'Which recurring customer problems could become proprietary software products that we eventually license to other HighLevel agencies?',
    ],
  },
  {
    id: 'leadership', icon: '🏛️', title: 'Leadership Intelligence', color: '#14B8A6',
    goal: 'An executive analyst that understands the organization.',
    prompts: [
      'Give me an executive summary of the most important things that happened across Little Giant this week.',
      "What problems have employees brought up repeatedly that leadership hasn't adequately addressed?",
      'Which employees or departments are taking on the most commitments, and where are responsibilities becoming unclear?',
      'What were the five biggest customer wins mentioned in meetings this month that we could turn into testimonials or case studies?',
      'If you were the CEO of Little Giant, what five issues from the past 30 days would you prioritize and why?',
    ],
  },
]
