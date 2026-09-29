const demoCustomers = [
  {
    id: 'CUST-001',
    name: 'Rahul Sharma',
    company: 'Northstar Analytics',
    product: 'Business analytics platform',
    initials: 'RS',
    color: 'coral',
    preview: 'Price concern · discount request',
    conversation: 'Employee A: Hi Rahul, how did you find the product?\nRahul: I really like it, but ₹50,000 is a little expensive for me. Is there any possibility of a 20% discount? I may consider buying next month.',
  },
  {
    id: 'CUST-002',
    name: 'Priya Nair',
    company: 'Fieldnote Retail',
    product: 'Business analytics platform',
    initials: 'PN',
    color: 'blue',
    preview: 'Comparing a competitor',
    conversation: 'Employee A: What is holding up the decision?\nPriya: We are also looking at MetricWorks. I like your reporting, but I need to compare how both products handle regional sales first.',
  },
  {
    id: 'CUST-003',
    name: 'Arjun Mehta',
    company: 'Meridian Supply Co.',
    product: 'Business analytics platform',
    initials: 'AM',
    color: 'green',
    preview: 'Support issue still open',
    conversation: 'Employee A: Were you able to finish the import?\nArjun: No, the CSV import still drops our date column. Support said they were investigating, but I have not heard that it is fixed yet.',
  },
  {
    id: 'CUST-004',
    name: 'Sneha Iyer',
    company: 'Brightpath Learning',
    product: 'Business analytics platform',
    initials: 'SI',
    color: 'violet',
    preview: 'Follow-up requested next week',
    conversation: 'Employee A: Shall we schedule another walkthrough?\nSneha: Please follow up next Tuesday after I have reviewed this with my operations lead. I am interested in seeing the cohort report again.',
  },
  {
    id: 'CUST-005',
    name: 'Kiran Rao',
    company: 'Copperline Foods',
    product: 'Business analytics platform',
    initials: 'KR',
    color: 'yellow',
    preview: 'Prefers concise weekly summaries',
    conversation: 'Employee A: How would you like the team to share the numbers?\nKiran: A short weekly email with the three most important metrics works best. I do not need a daily dashboard notification.',
  },
] as const

export type Customer = {
  id: string
  name: string
  company: string
  product: string
  initials: string
  color: string
  preview: string
  conversation: string
}

export let customers: Customer[] = [...demoCustomers]

export function nextCustomerId(): string {
  const numbers = customers
    .map((customer) => Number.parseInt(customer.id.replace(/\D/g, ''), 10))
    .filter((value) => Number.isFinite(value))
  const nextNumber = Math.max(0, ...numbers) + 1
  return `CUST-${String(nextNumber).padStart(3, '0')}`
}

export function addCustomer(input: { name: string; company: string; product: string; conversation?: string; preview?: string }): Customer {
  const name = input.name.trim()
  const company = input.company.trim()
  const product = input.product.trim()
  const customerId = nextCustomerId()
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || 'NC'
  const customer: Customer = {
    id: customerId,
    name,
    company,
    product,
    initials,
    color: ['coral', 'blue', 'green', 'violet', 'yellow', 'teal', 'rose', 'slate'][customers.length % 8],
    preview: input.preview?.trim() || 'New customer',
    conversation: input.conversation?.trim() || `Employee A: We are starting a new relationship with ${name}.\n${name}: We are interested in learning more about the product and how it would fit our workflow.`,
  }
  customers.push(customer)
  return customer
}

export function findCustomer(id: string): Customer | undefined {
  return customers.find((customer) => customer.id === id)
}

export function bankIdFor(customerId: string): string {
  return `teammind-${customerId.toLowerCase()}`
}

export function customerTag(customerId: string): string {
  return `customer:${customerId}`
}