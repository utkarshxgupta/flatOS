import React, { useState, useEffect, useRef } from 'react';
import { useAppContext } from '../AppContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, query, where, onSnapshot, doc, updateDoc, getDoc, setDoc, deleteDoc, getDocs } from 'firebase/firestore';
import { parseReceipt, parseSplitwiseScreenshot } from '../lib/gemini';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Camera, Upload, Receipt, CheckCircle2, Circle, Repeat, Play, Trash2, ChevronDown, ChevronUp, Edit2 } from 'lucide-react';
import { toast } from 'sonner';
import { addMonths, isPast, parseISO, format } from 'date-fns';

export default function ExpensesPage() {
  const { user, flatId } = useAppContext();
  const [expenses, setExpenses] = useState<any[]>([]);
  const [recurringExpenses, setRecurringExpenses] = useState<any[]>([]);
  const [flatmates, setFlatmates] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Manual Expense State
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [splitWith, setSplitWith] = useState<string[]>([]);
  const [editingExpense, setEditingExpense] = useState<any>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editSplitBetween, setEditSplitBetween] = useState<string[]>([]);

  // Recurring Expense State
  const [recTitle, setRecTitle] = useState('');
  const [recAmount, setRecAmount] = useState('');
  const [recSplitWith, setRecSplitWith] = useState<string[]>([]);

  // Receipt Parsing State
  const [parsedItems, setParsedItems] = useState<any[]>([]);
  const [receiptTotal, setReceiptTotal] = useState(0);
  const [receiptMerchant, setReceiptMerchant] = useState<string>('');

  // Splitwise Import State
  const [splitwiseResult, setSplitwiseResult] = useState<{ personas: string[], debts: any[] } | null>(null);
  const [selectedPersonas, setSelectedPersonas] = useState<string[]>([]);
  const splitwiseInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!flatId) return;

    const usersQuery = query(collection(db, 'users'), where('flatId', '==', flatId));
    const unsubUsers = onSnapshot(usersQuery, (snapshot) => {
      setFlatmates(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const expensesQuery = query(collection(db, 'expenses'), where('flatId', '==', flatId));
    const unsubExpenses = onSnapshot(expensesQuery, (snapshot) => {
      const exps = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
      exps.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setExpenses(exps);
    });

    const recurringQuery = query(collection(db, 'recurringExpenses'), where('flatId', '==', flatId));
    const unsubRecurring = onSnapshot(recurringQuery, (snapshot) => {
      const recs = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
      setRecurringExpenses(recs);
    });

    return () => {
      unsubUsers();
      unsubExpenses();
      unsubRecurring();
    };
  }, [flatId]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (!files.length) return;

    setLoading(true);
    setReceiptParsingStatus('loading');
    setIsReceiptDialogOpen(true);
    toast.info('Analyzing receipt(s) with AI...');
    
    try {
      const readFilesAsBase64 = files.map(file => {
        return new Promise<{base64Image: string, mimeType: string}>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64String = (reader.result as string).split(',')[1];
            resolve({ base64Image: base64String, mimeType: file.type });
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      });

      const images = await Promise.all(readFilesAsBase64);
      const result = await parseReceipt(images);
      
      setReceiptTotal(result.totalAmount);
      setReceiptMerchant(result.merchantName || 'Receipt');
      // Initialize all items as shared by everyone by default
      const itemsWithSplit = result.items.map((item: any) => ({
        ...item,
        splitBetween: flatmates.map(m => m.id),
        addToPantry: item.isGrocery ?? false
      }));
      setParsedItems(itemsWithSplit);
      setReceiptParsingStatus('success');
      toast.success('Receipt(s) parsed successfully!');
    } catch (error) {
      console.error(error);
      setIsReceiptDialogOpen(false);
      setReceiptParsingStatus('');
      toast.error('Failed to parse receipt(s)');
    } finally {
      setLoading(false);
      if (e.target) {
        e.target.value = ''; // reset input
      }
    }
  };

  const toggleItemSplit = (itemIndex: number, userId: string) => {
    setParsedItems(prev => {
      const newItems = [...prev];
      const item = { ...newItems[itemIndex] };
      if (item.splitBetween.includes(userId)) {
        item.splitBetween = item.splitBetween.filter((id: string) => id !== userId);
      } else {
        item.splitBetween = [...item.splitBetween, userId];
      }
      newItems[itemIndex] = item;
      return newItems;
    });
  };

  const toggleAddToPantry = (itemIndex: number) => {
    setParsedItems(prev => {
      const newItems = [...prev];
      const item = { ...newItems[itemIndex] };
      item.addToPantry = !item.addToPantry;
      newItems[itemIndex] = item;
      return newItems;
    });
  };

  const parseQuantity = (q: string) => {
    const match = q.toString().toLowerCase().match(/([\d.]+)\s*([a-zA-Z]+)?(?:\s*(?:x|\*)\s*([\d.]+))?/);
    if (match) {
      const num1 = parseFloat(match[1]);
      const unit = match[2] || '';
      const num2 = match[3] ? parseFloat(match[3]) : 1;
      return { val: num1 * num2, unit: unit.trim() };
    }
    return { val: 0, unit: q };
  };

  // Shopping list matching state
  const [shoppingListMatches, setShoppingListMatches] = useState<{ id: string, name: string, matchedParsedItem: string }[]>([]);
  const [showShoppingListDialog, setShowShoppingListDialog] = useState(false);
  const [selectedMatchesToCheckout, setSelectedMatchesToCheckout] = useState<string[]>([]);
  const [isFinalizingSubmit, setIsFinalizingSubmit] = useState(false);
  
  // New Dialog State for Parsed Receipt Items
  const [isReceiptDialogOpen, setIsReceiptDialogOpen] = useState(false);
  const [receiptParsingStatus, setReceiptParsingStatus] = useState<'' | 'loading' | 'success'>('');

  const addQuantities = (q1: string, q2: string) => {
    const p1 = parseQuantity(q1);
    const p2 = parseQuantity(q2);
    if (p1.val > 0 && p2.val > 0 && p1.unit === p2.unit) {
      return `${p1.val + p2.val} ${p1.unit}`.trim();
    }
    return `${q1} + ${q2}`;
  };

  const submitParsedReceipt = async () => {
    if (!user || !flatId) return;
    setLoading(true);
    
    try {
      const shoppingSnap = await getDocs(query(collection(db, 'shoppingList'), where('flatId', '==', flatId)));
      const shoppingListItems = shoppingSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

      const matches: { id: string, name: string, matchedParsedItem: string }[] = [];
      const parsedItemNames = parsedItems.filter(i => i.addToPantry).map(i => i.name.toLowerCase().replace(/[^a-z0-9]/g, ''));
      
      const parsedItemDocs = parsedItems.filter(i => i.addToPantry);

      for (const sItem of shoppingListItems) {
        const sName = sItem.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        // Simple fuzzy match check
        const matchDoc = parsedItemDocs.find(p => {
          const pName = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          return pName.includes(sName) || sName.includes(pName);
        });
        
        if (matchDoc) {
          matches.push({ id: sItem.id, name: sItem.name, matchedParsedItem: matchDoc.name });
        }
      }

      setLoading(false);
      if (matches.length > 0) {
        setShoppingListMatches(matches);
        setSelectedMatchesToCheckout(matches.map(m => m.id));
        setShowShoppingListDialog(true);
      } else {
        await finalSubmitParsedReceipt();
      }
    } catch (e) {
      setLoading(false);
      toast.error('Error checking shopping list match');
      await finalSubmitParsedReceipt();
    }
  };

  const finalSubmitParsedReceipt = async () => {
    if (!user || !flatId) return;
    setIsFinalizingSubmit(true);
    try {
      // Check off selected shopping list items
      if (selectedMatchesToCheckout.length > 0) {
        for (const itemId of selectedMatchesToCheckout) {
          await deleteDoc(doc(db, 'shoppingList', itemId));
        }
        toast.success(`Removed ${selectedMatchesToCheckout.length} items from Shopping List`);
      }

      const groupId = `receipt_${Date.now()}`;
      const groupTitle = receiptMerchant ? `${receiptMerchant} Order` : 'Receipt Upload';
      
      // Fetch existing pantry items for fuzzy matching
      const pantrySnap = await getDocs(query(collection(db, 'pantryItems'), where('flatId', '==', flatId)));
      const existingPantryItems = pantrySnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

      // Create an expense for each item
      for (const item of parsedItems) {
        if (item.splitBetween.length === 0) continue; // Skip unassigned items
        
        await addDoc(collection(db, 'expenses'), {
          flatId,
          title: item.name,
          amount: item.price,
          paidBy: user.uid,
          splitBetween: item.splitBetween,
          date: new Date().toISOString(),
          settled: false,
          groupId,
          groupTitle
        });

        // If it's marked for pantry, add to pantry or update existing
        if (item.addToPantry) {
          const normalizedNewName = item.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          const matchedItem = existingPantryItems.find(existing => {
            const normalizedExisting = existing.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            return normalizedExisting.includes(normalizedNewName) || normalizedNewName.includes(normalizedExisting);
          });

          const itemQuantity = item.quantity || '1';
          const newHistoryEntry = { quantity: itemQuantity, date: new Date().toISOString() };

          if (matchedItem) {
            // Update existing item
            const newQuantity = addQuantities(matchedItem.quantity, itemQuantity);
            const newHistory = matchedItem.history ? [...matchedItem.history, newHistoryEntry] : [
              { quantity: matchedItem.quantity, date: matchedItem.dateAdded },
              newHistoryEntry
            ];
            
            await updateDoc(doc(db, 'pantryItems', matchedItem.id), {
              quantity: newQuantity,
              dateAdded: new Date().toISOString(), // refresh date
              history: newHistory,
              emojis: matchedItem.emojis || item.emojis || ''
            });
          } else {
            // Add new item
            await addDoc(collection(db, 'pantryItems'), {
              flatId,
              name: item.name,
              quantity: itemQuantity,
              unit: 'unit',
              category: item.category || 'Groceries',
              healthTag: item.healthTag || '',
              emojis: item.emojis || '',
              addedBy: user.uid,
              dateAdded: new Date().toISOString(),
              history: [newHistoryEntry]
            });
          }
        }
      }

      // Award Karma for uploading receipt
      await addDoc(collection(db, 'karmaLogs'), {
        flatId,
        userId: user.uid,
        action: 'Uploaded a household receipt',
        points: 20,
        date: new Date().toISOString()
      });

      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        await updateDoc(userRef, { karma: (userSnap.data().karma || 0) + 20 });
      }

      toast.success('Receipt items added to expenses and pantry!');
      setParsedItems([]);
      setReceiptTotal(0);
      setReceiptMerchant('');
      setShowShoppingListDialog(false);
      setIsReceiptDialogOpen(false);
      setReceiptParsingStatus('');
      setShoppingListMatches([]);
      setSelectedMatchesToCheckout([]);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'expenses');
      toast.error('Failed to save receipt items');
    } finally {
      setIsFinalizingSubmit(false);
    }
  };

  const handleSplitwiseUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    toast.info('Analyzing Splitwise screenshot...');
    
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64String = (reader.result as string).split(',')[1];
        const result = await parseSplitwiseScreenshot(base64String, file.type);
        
        setSplitwiseResult(result);
        setSelectedPersonas(result.personas);
        toast.success('Screenshot parsed successfully!');
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error(error);
      toast.error('Failed to parse screenshot');
    } finally {
      setLoading(false);
    }
  };

  const submitSplitwiseImport = async () => {
    if (!user || !flatId || !splitwiseResult) return;
    setLoading(true);
    try {
      const personaToIdMap: Record<string, string> = {};
      
      for (const personaName of selectedPersonas) {
        const existing = flatmates.find(m => m.displayName?.toLowerCase().includes(personaName.toLowerCase()) || personaName.toLowerCase().includes(m.displayName?.toLowerCase()));
        
        if (existing) {
          personaToIdMap[personaName] = existing.id;
        } else {
          const dummyId = `dummy_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          await setDoc(doc(db, 'users', dummyId), {
            uid: dummyId,
            displayName: personaName,
            email: `${dummyId}@dummy.flatos`,
            photoURL: `https://api.dicebear.com/7.x/avataaars/svg?seed=${personaName}`,
            karma: 0,
            flatId,
            isDummy: true
          });
          personaToIdMap[personaName] = dummyId;
        }
      }

      const getPersonaId = (name: string) => {
        const key = Object.keys(personaToIdMap).find(k => k.toLowerCase() === name.toLowerCase() || k.includes(name) || name.includes(k));
        return key ? personaToIdMap[key] : null;
      };

      for (const debt of splitwiseResult.debts) {
        // Only process if both payer and borrower were selected for import
        const payerKey = selectedPersonas.find(p => p.toLowerCase() === debt.payer.toLowerCase() || p.includes(debt.payer) || debt.payer.includes(p));
        const borrowerKey = selectedPersonas.find(p => p.toLowerCase() === debt.borrower.toLowerCase() || p.includes(debt.borrower) || debt.borrower.includes(p));

        if (payerKey && borrowerKey) {
          const payerId = getPersonaId(debt.payer);
          const borrowerId = getPersonaId(debt.borrower);
          
          if (payerId && borrowerId) {
            await addDoc(collection(db, 'expenses'), {
              flatId,
              title: `Imported Balance (${debt.borrower} owes ${debt.payer})`,
              amount: Number(debt.amount) || 0,
              paidBy: payerId,
              splitBetween: [borrowerId],
              date: new Date().toISOString(),
              settled: false
            });
          }
        }
      }

      toast.success('Splitwise balances imported!');
      setSplitwiseResult(null);
      setSelectedPersonas([]);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'expenses');
      toast.error('Failed to import balances');
    } finally {
      setLoading(false);
    }
  };

  const submitManualExpense = async () => {
    if (!user || !flatId || !title || !amount || splitWith.length === 0) return;
    setLoading(true);
    try {
      await addDoc(collection(db, 'expenses'), {
        flatId,
        title,
        amount: parseFloat(amount),
        paidBy: user.uid,
        splitBetween: splitWith,
        date: new Date().toISOString(),
        settled: false
      });
      toast.success('Expense added!');
      setTitle('');
      setAmount('');
      setSplitWith([]);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'expenses');
      toast.error('Failed to add expense');
    } finally {
      setLoading(false);
    }
  };

  const submitRecurringExpense = async () => {
    if (!user || !flatId || !recTitle || !recAmount || recSplitWith.length === 0) return;
    setLoading(true);
    try {
      const nextDueDate = new Date();
      nextDueDate.setHours(0, 0, 0, 0); // Start of today

      await addDoc(collection(db, 'recurringExpenses'), {
        flatId,
        title: recTitle,
        amount: parseFloat(recAmount),
        paidBy: user.uid,
        splitBetween: recSplitWith,
        frequency: 'monthly',
        nextDueDate: nextDueDate.toISOString()
      });
      toast.success('Recurring bill added!');
      setRecTitle('');
      setRecAmount('');
      setRecSplitWith([]);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'recurringExpenses');
      toast.error('Failed to add recurring bill');
    } finally {
      setLoading(false);
    }
  };

  const postRecurringBill = async (bill: any) => {
    if (!user || !flatId) return;
    try {
      // 1. Create the expense
      await addDoc(collection(db, 'expenses'), {
        flatId,
        title: `${bill.title} (Auto)`,
        amount: bill.amount,
        paidBy: bill.paidBy,
        splitBetween: bill.splitBetween,
        date: new Date().toISOString(),
        settled: false
      });

      // 2. Update the next due date
      const currentDueDate = parseISO(bill.nextDueDate);
      const nextDate = addMonths(currentDueDate, 1);
      
      await updateDoc(doc(db, 'recurringExpenses', bill.id), {
        nextDueDate: nextDate.toISOString()
      });

      toast.success(`Posted ${bill.title} to ledger!`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `recurringExpenses/${bill.id}`);
      toast.error('Failed to post recurring bill');
    }
  };

  const settleExpense = async (expenseId: string) => {
    try {
      await updateDoc(doc(db, 'expenses', expenseId), { settled: true });
      
      // Award karma for settling
      if (user && flatId) {
        await addDoc(collection(db, 'karmaLogs'), {
          flatId,
          userId: user.uid,
          action: 'Settled an expense',
          points: 10,
          date: new Date().toISOString()
        });
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          await updateDoc(userRef, { karma: (userSnap.data().karma || 0) + 10 });
        }
      }
      toast.success('Expense settled!');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `expenses/${expenseId}`);
      toast.error('Failed to settle expense');
    }
  };

  const undoSettleExpense = async (expenseId: string) => {
    try {
      await updateDoc(doc(db, 'expenses', expenseId), { settled: false });
      toast.success('Settlement undone!');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `expenses/${expenseId}`);
      toast.error('Failed to undo settlement');
    }
  };

  const deleteExpense = async (expenseId: string) => {
    try {
      await deleteDoc(doc(db, 'expenses', expenseId));
      toast.success('Expense deleted');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `expenses/${expenseId}`);
      toast.error('Failed to delete expense');
    }
  };

  // Calculate balances
  const balances: Record<string, number> = {};
  flatmates.forEach(m => balances[m.id] = 0);

  expenses.forEach(exp => {
    if (exp.settled && !exp.isPayment) return;
    const splitAmount = exp.amount / exp.splitBetween.length;
    
    // Person who paid gets positive balance
    if (balances[exp.paidBy] !== undefined) {
      balances[exp.paidBy] += exp.amount;
    }

    // People who owe get negative balance
    exp.splitBetween.forEach((uid: string) => {
      if (balances[uid] !== undefined) {
        balances[uid] -= splitAmount;
      }
    });
  });

  // Group expenses by groupId
  const groupedExpenses: any[] = [];
  const groupMap = new Map<string, any>();

  expenses.forEach(exp => {
    if (exp.groupId) {
      if (!groupMap.has(exp.groupId)) {
        const newGroup = {
          isGroup: true,
          id: exp.groupId,
          title: exp.groupTitle || 'Receipt Upload',
          amount: 0,
          paidBy: exp.paidBy,
          date: exp.date,
          settled: true,
          items: []
        };
        groupMap.set(exp.groupId, newGroup);
        groupedExpenses.push(newGroup);
      }
      const group = groupMap.get(exp.groupId);
      group.items.push(exp);
      group.amount += exp.amount;
      if (!exp.settled) group.settled = false;
    } else {
      groupedExpenses.push({ isGroup: false, ...exp });
    }
  });

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const [settleDialogOpen, setSettleDialogOpen] = useState(false);
  const [settleTarget, setSettleTarget] = useState<string>('');
  const [settleAmount, setSettleAmount] = useState('');

  const handleCustomSettle = async () => {
    if (!user || !flatId || !settleTarget || !settleAmount) return;
    const amountNum = parseFloat(settleAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    try {
      await addDoc(collection(db, 'expenses'), {
        flatId,
        title: 'Settlement Payment',
        amount: amountNum,
        paidBy: user.uid,
        splitBetween: [settleTarget],
        date: new Date().toISOString(),
        settled: true, // It's a payment, so it doesn't need settling itself
        isPayment: true
      });
      toast.success('Payment recorded successfully');
      setSettleDialogOpen(false);
      setSettleAmount('');
      setSettleTarget('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'expenses');
      toast.error('Failed to record payment');
    }
  };

  const saveEditedExpense = async () => {
    if (!editingExpense) return;
    if (editSplitBetween.length === 0) {
      toast.error('At least one person must be selected for the split.');
      return;
    }
    
    try {
      await updateDoc(doc(db, 'expenses', editingExpense.id), {
        amount: parseFloat(editAmount),
        splitBetween: editSplitBetween
      });
      toast.success('Expense updated');
      setEditingExpense(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `expenses/${editingExpense.id}`);
      toast.error('Failed to update expense');
    }
  };

  const getSplitText = (splitBetween: string[], paidBy: string) => {
    if (!splitBetween || splitBetween.length === 0) return '';
    if (splitBetween.length === flatmates.length) return 'Split equally';
    
    const payerIncluded = splitBetween.includes(paidBy);
    const otherNames = splitBetween
      .filter((id: string) => id !== paidBy)
      .map((id: string) => flatmates.find((m: any) => m.id === id)?.displayName?.split(' ')[0] || 'Unknown');
    
    if (otherNames.length === 0) {
      if (payerIncluded) return 'Personal Expense';
      return 'Not split';
    }

    if (!payerIncluded) {
      return `Paid for ${otherNames.join(', ')}`;
    }
    
    return `Split with ${otherNames.join(', ')}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Expenses</h1>
        <p className="text-muted-foreground mt-1">Manage shared costs and settle up.</p>
      </div>

      <Tabs defaultValue="ledger" className="w-full">
        <TabsList className="grid w-full grid-cols-3 mb-8 bg-muted/70 rounded-2xl p-1 shadow-inner border border-border/40 min-h-[44px] backdrop-blur-md">
          <TabsTrigger value="ledger" className="rounded-xl text-xs sm:text-sm font-semibold data-active:shadow-md data-active:bg-background transition-all duration-200">Ledger</TabsTrigger>
          <TabsTrigger value="add" className="rounded-xl text-xs sm:text-sm font-semibold data-active:shadow-md data-active:bg-background transition-all duration-200">Add Expense</TabsTrigger>
          <TabsTrigger value="recurring" className="rounded-xl text-xs sm:text-sm font-semibold data-active:shadow-md data-active:bg-background transition-all duration-200">Recurring</TabsTrigger>
        </TabsList>

        <TabsContent value="ledger" className="space-y-6">
          {/* Balances */}
          <Card className="rounded-3xl shadow-sm border-0 bg-card">
            <CardHeader>
              <CardTitle className="text-lg font-medium">Net Balances</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {flatmates.map(mate => {
                  const bal = balances[mate.id] || 0;
                  return (
                    <div key={mate.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={mate.photoURL} />
                          <AvatarFallback>{mate.displayName?.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium">{mate.displayName}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`font-mono font-medium ${bal > 0 ? 'text-green-600' : bal < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                          {bal > 0 ? '+' : ''}{bal.toFixed(2)}
                        </span>
                        {mate.id !== user?.uid && bal > 0 && balances[user?.uid || ''] < -0.01 && (
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="h-7 text-xs rounded-full"
                            onClick={() => {
                              setSettleTarget(mate.id);
                              setSettleAmount(Math.min(bal, Math.abs(balances[user?.uid || ''])).toFixed(2));
                              setSettleDialogOpen(true);
                            }}
                          >
                            Settle
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Recent Expenses */}
          <div className="space-y-4">
            <h3 className="font-semibold text-lg px-1">Recent Transactions</h3>
            {groupedExpenses.map(group => {
              if (group.isGroup) {
                const isExpanded = expandedGroups[group.id];
                const payer = flatmates.find(m => m.id === group.paidBy);
                return (
                  <Card key={group.id} className={`rounded-2xl shadow-sm border-0 transition-opacity ${group.settled ? 'opacity-50' : ''}`}>
                    <CardContent className="p-0">
                      <div 
                        className="p-4 flex items-center justify-between cursor-pointer hover:bg-muted/30 transition-colors"
                        onClick={() => toggleGroup(group.id)}
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                            <Receipt size={20} />
                          </div>
                          <div>
                            <p className="font-medium">{group.title}</p>
                            <p className="text-xs text-muted-foreground">Paid by {payer?.displayName || 'Unknown'} • {group.items.length} items</p>
                            {group.date && <p className="text-[10px] text-muted-foreground/80 mt-0.5">Added on {format(parseISO(group.date), 'MMM d, yyyy h:mm a')}</p>}
                          </div>
                        </div>
                        <div className="text-right flex items-center gap-3">
                          <span className="font-mono font-medium">{group.amount.toFixed(2)}</span>
                          {isExpanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
                        </div>
                      </div>
                      
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-2 border-t bg-muted/10">
                          <div className="space-y-3">
                            {group.items.map((exp: any) => (
                              <div key={exp.id} className="flex justify-between items-center text-sm py-1">
                                <div className="flex-1">
                                  <p className="font-medium">{exp.title}</p>
                                  <p className="text-[10px] text-muted-foreground">{getSplitText(exp.splitBetween, exp.paidBy)}</p>
                                  {exp.date && <p className="text-[10px] text-muted-foreground/80 mt-0.5">Added on {format(parseISO(exp.date), 'MMM d, yyyy h:mm a')}</p>}
                                  <div className="flex gap-2 mt-1">
                                    {exp.paidBy === user?.uid && (
                                      <>
                                        <button onClick={() => { setEditingExpense(exp); setEditAmount(exp.amount.toString()); setEditSplitBetween(exp.splitBetween || []); }} className="text-xs text-primary hover:underline flex items-center gap-1"><Edit2 size={10} /> Edit</button>
                                        <button onClick={() => deleteExpense(exp.id)} className="text-xs text-red-500 hover:underline flex items-center gap-1"><Trash2 size={10} /> Delete</button>
                                      </>
                                    )}
                                  </div>
                                </div>
                                <div className="text-right flex flex-col items-end gap-1">
                                  <span className="font-mono">{exp.amount.toFixed(2)}</span>
                                  {exp.settled && (
                                    <div className="flex items-center gap-1">
                                      <Badge variant="secondary" className="text-[8px] px-1 py-0">Settled</Badge>
                                      <button className="text-[10px] text-muted-foreground hover:underline" onClick={() => undoSettleExpense(exp.id)}>Undo</button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              }

              // Individual expense
              const exp = group;
              const payer = flatmates.find(m => m.id === exp.paidBy);
              return (
                <Card key={exp.id} className={`rounded-2xl shadow-sm border-0 transition-opacity ${exp.settled ? 'opacity-50' : ''}`}>
                  <CardContent className="p-6 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                        <Receipt size={20} />
                      </div>
                      <div>
                        <p className="font-medium">{exp.title}</p>
                        <p className="text-xs text-muted-foreground">Paid by {payer?.displayName || 'Unknown'}</p>
                        {!exp.isPayment && (
                          <p className="text-[10px] text-muted-foreground opacity-80">{getSplitText(exp.splitBetween, exp.paidBy)}</p>
                        )}
                        {exp.date && <p className="text-[10px] text-muted-foreground/80 mt-0.5">Added on {format(parseISO(exp.date), 'MMM d, yyyy h:mm a')}</p>}
                        <div className="flex gap-2 mt-1">
                          {exp.paidBy === user?.uid && (
                            <>
                              <button onClick={() => { setEditingExpense(exp); setEditAmount(exp.amount.toString()); setEditSplitBetween(exp.splitBetween || []); }} className="text-xs text-primary hover:underline flex items-center gap-1"><Edit2 size={10} /> Edit</button>
                              <button onClick={() => deleteExpense(exp.id)} className="text-xs text-red-500 hover:underline flex items-center gap-1"><Trash2 size={10} /> Delete</button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right flex flex-col items-end gap-2">
                      <span className="font-mono font-medium">{exp.amount.toFixed(2)}</span>
                      {exp.settled && !exp.isPayment && (
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-[10px]">Settled</Badge>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] rounded-full hover:bg-muted" onClick={() => undoSettleExpense(exp.id)}>
                            Undo
                          </Button>
                        </div>
                      )}
                      {exp.isPayment && (
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-[10px] bg-green-500/10 text-green-600">Payment</Badge>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {expenses.length === 0 && (
              <p className="text-center text-muted-foreground py-8">No expenses yet.</p>
            )}
          </div>
        </TabsContent>

        <Dialog open={!!editingExpense} onOpenChange={(open) => !open && setEditingExpense(null)}>
          <DialogContent className="sm:max-w-md rounded-3xl">
            <DialogHeader>
              <DialogTitle>Edit Expense</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input 
                  type="number" 
                  value={editAmount} 
                  onChange={e => setEditAmount(e.target.value)} 
                  placeholder="0.00" 
                />
              </div>
              <div className="space-y-2">
                <Label>Split Between</Label>
                <div className="flex flex-wrap gap-2 pt-1">
                  {flatmates.map(mate => {
                    const isSelected = editSplitBetween.includes(mate.id);
                    return (
                      <button
                        key={mate.id}
                        onClick={() => {
                          setEditSplitBetween(prev => 
                            prev.includes(mate.id) ? prev.filter(id => id !== mate.id) : [...prev, mate.id]
                          );
                        }}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors ${
                          isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                      >
                        <Avatar className="h-5 w-5">
                          <AvatarImage src={mate.photoURL} />
                          <AvatarFallback>{mate.displayName?.charAt(0)}</AvatarFallback>
                        </Avatar>
                        {mate.displayName?.split(' ')[0]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Button className="w-full rounded-full" onClick={saveEditedExpense}>Save Changes</Button>
            </div>
          </DialogContent>
        </Dialog>

        <TabsContent value="add" className="space-y-6">
          <div className="flex flex-col gap-6 max-w-2xl mx-auto">
            {/* AI Receipt Upload */}
            <Card className="rounded-3xl shadow-sm border-0 bg-card overflow-hidden h-fit p-0">
              <div className="bg-primary/5 p-6 text-center">
                <div className="mx-auto w-16 h-16 bg-card rounded-full flex items-center justify-center shadow-sm mb-4 text-primary">
                  <Camera size={28} />
                </div>
                <h3 className="font-semibold text-lg mb-2">Smart Receipt Scan</h3>
                <p className="text-sm text-muted-foreground mb-4 max-w-xs mx-auto">
                  Upload a screenshot from Zepto, Blinkit, or Swiggy. We'll extract the items and add groceries to your pantry automatically.
                </p>
                <input 
                  type="file" 
                  accept="image/*" 
                  multiple
                  className="hidden" 
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                />
                <Button 
                  onClick={() => fileInputRef.current?.click()} 
                  className="rounded-full"
                >
                  Upload Receipt
                  <Upload size={16} className="ml-2" />
                </Button>
              </div>
            </Card>

            {/* Splitwise Import (Compact Dialog) */}
            <Dialog>
              <DialogTrigger render={<Button variant="outline" className="w-full rounded-full border-dashed text-muted-foreground h-12 hover:bg-green-500/5 hover:text-green-600 hover:border-green-500/30 transition-colors" />}>
                <Upload size={16} className="mr-2" />
                Import balances from Splitwise
              </DialogTrigger>
              <DialogContent className="sm:max-w-md rounded-3xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Splitwise Import</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="bg-green-500/5 p-6 border rounded-2xl border-green-500/10 text-center">
                    <div className="mx-auto w-12 h-12 bg-card rounded-full flex items-center justify-center shadow-sm mb-3 text-green-500">
                      <Upload size={24} />
                    </div>
                    <p className="text-sm text-muted-foreground mb-4">
                      Upload a screenshot of your Splitwise group balances. We'll import the debts and create temporary profiles for missing flatmates.
                    </p>
                    <input 
                      type="file" 
                      accept="image/*" 
                      className="hidden" 
                      ref={splitwiseInputRef}
                      onChange={handleSplitwiseUpload}
                    />
                    <Button 
                      onClick={() => splitwiseInputRef.current?.click()} 
                      disabled={loading}
                      className="rounded-full bg-green-600 hover:bg-green-700 w-full"
                    >
                      {loading ? 'Analyzing...' : 'Upload Screenshot'}
                    </Button>
                  </div>

                  {splitwiseResult && (
                    <div className="space-y-3">
                      <div className="p-3 bg-muted/30 rounded-xl border">
                        <span className="font-medium text-sm">Select Personas to Import</span>
                        <p className="text-xs text-muted-foreground mt-1">Uncheck anyone you don't want to import balances for.</p>
                      </div>
                      <div className="space-y-2">
                        {splitwiseResult.personas.map((persona, idx) => {
                          const isSelected = selectedPersonas.includes(persona);
                          const existing = flatmates.find(m => m.displayName?.toLowerCase().includes(persona.toLowerCase()) || persona.toLowerCase().includes(m.displayName?.toLowerCase()));
                          
                          return (
                            <div 
                              key={idx} 
                              className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-colors ${isSelected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
                              onClick={() => {
                                setSelectedPersonas(prev => 
                                  prev.includes(persona) ? prev.filter(p => p !== persona) : [...prev, persona]
                                );
                              }}
                            >
                              <div className="flex items-center gap-3">
                                <div className={`w-5 h-5 rounded-full flex items-center justify-center border ${isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground'}`}>
                                  {isSelected && <CheckCircle2 size={14} />}
                                </div>
                                <div>
                                  <p className="font-medium text-sm">{persona}</p>
                                  {existing ? (
                                    <p className="text-[10px] text-green-600">Matches existing flatmate</p>
                                  ) : (
                                    <p className="text-[10px] text-amber-600">Will create dummy persona</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <Button className="w-full rounded-full" onClick={submitSplitwiseImport} disabled={loading || selectedPersonas.length === 0}>
                        Import Selected Balances
                      </Button>
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="flex items-center gap-4 py-2 max-w-2xl mx-auto">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Or enter manually</span>
            <Separator className="flex-1" />
          </div>

          {/* Manual Entry */}
          <Card className="rounded-3xl shadow-sm border-0 bg-card max-w-2xl mx-auto">
            <CardContent className="p-6 space-y-4">
              <div className="space-y-2">
                <Label>Description</Label>
                <Input placeholder="e.g. Electricity Bill" value={title} onChange={e => setTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Split Between</Label>
                <div className="flex flex-wrap gap-2 pt-1">
                  {flatmates.map(mate => {
                    const isSelected = splitWith.includes(mate.id);
                    return (
                      <button
                        key={mate.id}
                        onClick={() => {
                          setSplitWith(prev => 
                            prev.includes(mate.id) ? prev.filter(id => id !== mate.id) : [...prev, mate.id]
                          );
                        }}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors ${
                          isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                      >
                        <Avatar className="h-5 w-5">
                          <AvatarImage src={mate.photoURL} />
                          <AvatarFallback>{mate.displayName?.charAt(0)}</AvatarFallback>
                        </Avatar>
                        {mate.displayName?.split(' ')[0]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Button className="w-full rounded-full mt-2" onClick={submitManualExpense} disabled={loading || !title || !amount || splitWith.length === 0}>
                Add Expense
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recurring" className="space-y-6">
          <Card className="rounded-3xl shadow-sm border-0 bg-card">
            <CardHeader>
              <CardTitle className="text-lg font-medium flex items-center gap-2">
                <Repeat size={18} /> Recurring Bills
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {recurringExpenses.map(bill => {
                  const payer = flatmates.find(m => m.id === bill.paidBy);
                  const isDue = isPast(parseISO(bill.nextDueDate));
                  
                  return (
                    <div key={bill.id} className="flex items-center justify-between p-4 rounded-2xl border bg-card shadow-sm">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                          <Repeat size={20} />
                        </div>
                        <div>
                          <p className="font-medium">{bill.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {bill.amount.toFixed(2)} • Paid by {payer?.displayName?.split(' ')[0]}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right hidden sm:block">
                          <p className="text-xs text-muted-foreground">Next Due</p>
                          <p className={`text-sm font-medium ${isDue ? 'text-red-500' : ''}`}>
                            {new Date(bill.nextDueDate).toLocaleDateString()}
                          </p>
                        </div>
                        <Button 
                          size="sm" 
                          variant={isDue ? "default" : "outline"} 
                          className="rounded-full"
                          onClick={() => postRecurringBill(bill)}
                        >
                          <Play size={14} className="mr-1" /> Post Now
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {recurringExpenses.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">No recurring bills set up.</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Add Recurring Bill */}
          <Card className="rounded-3xl shadow-sm border-0 bg-card">
            <CardHeader>
              <CardTitle className="text-lg font-medium">Add Recurring Bill</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Description</Label>
                <Input placeholder="e.g. Internet Bill" value={recTitle} onChange={e => setRecTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input type="number" placeholder="0.00" value={recAmount} onChange={e => setRecAmount(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Split Between</Label>
                <div className="flex flex-wrap gap-2 pt-1">
                  {flatmates.map(mate => {
                    const isSelected = recSplitWith.includes(mate.id);
                    return (
                      <button
                        key={mate.id}
                        onClick={() => {
                          setRecSplitWith(prev => 
                            prev.includes(mate.id) ? prev.filter(id => id !== mate.id) : [...prev, mate.id]
                          );
                        }}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors ${
                          isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                      >
                        <Avatar className="h-5 w-5">
                          <AvatarImage src={mate.photoURL} />
                          <AvatarFallback>{mate.displayName?.charAt(0)}</AvatarFallback>
                        </Avatar>
                        {mate.displayName?.split(' ')[0]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Button className="w-full rounded-full mt-2" onClick={submitRecurringExpense} disabled={loading || !recTitle || !recAmount || recSplitWith.length === 0}>
                Setup Monthly Bill
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
        <Dialog open={settleDialogOpen} onOpenChange={setSettleDialogOpen}>
          <DialogContent className="sm:max-w-md rounded-3xl">
            <DialogHeader>
              <DialogTitle>Settle Balance</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Amount to Pay</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input 
                    type="number" 
                    className="pl-7" 
                    value={settleAmount} 
                    onChange={(e) => setSettleAmount(e.target.value)} 
                    placeholder="0.00"
                  />
                </div>
              </div>
              <Button className="w-full rounded-full" onClick={handleCustomSettle}>
                Record Payment
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </Tabs>

      <Dialog open={isReceiptDialogOpen} onOpenChange={(open) => {
        if (!open && receiptParsingStatus !== 'loading') setIsReceiptDialogOpen(false);
      }}>
        <DialogContent className="sm:max-w-md rounded-3xl max-h-[85vh] overflow-hidden flex flex-col p-0">
          {receiptParsingStatus === 'loading' && (
            <div className="flex flex-col items-center justify-center p-12 text-center h-full">
              <div className="relative w-24 h-24 mb-6">
                <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping"></div>
                <div className="relative flex items-center justify-center w-full h-full bg-primary text-primary-foreground rounded-full animate-bounce">
                  <Receipt size={40} />
                </div>
              </div>
              <h3 className="text-xl font-bold mb-2">AI is reading your receipt...</h3>
              <p className="text-muted-foreground text-sm">Extracting items, prices, and finding grocery matches.</p>
            </div>
          )}
          
          {receiptParsingStatus === 'success' && (
            <>
              <div className="p-4 bg-muted/30 border-b flex justify-between items-center z-10 sticky top-0 backdrop-blur-md">
                <span className="font-semibold text-lg">Parsed Items</span>
                <span className="font-mono font-medium">Total: {receiptTotal.toFixed(2)}</span>
              </div>
              <ScrollArea className="flex-1 overflow-y-auto w-full h-full" style={{ maxHeight: 'calc(85vh - 140px)' }}>
                <div className="divide-y w-full">
                  {parsedItems.map((item, idx) => (
                    <div key={idx} className="p-4 space-y-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-sm">{item.name}</p>
                          <p className="text-xs text-muted-foreground">Qty: {item.quantity} • {item.category}</p>
                        </div>
                        <span className="font-mono text-sm font-medium">{item.price.toFixed(2)}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {flatmates.map(mate => {
                          const isSelected = item.splitBetween.includes(mate.id);
                          return (
                            <button
                              key={mate.id}
                              onClick={() => toggleItemSplit(idx, mate.id)}
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-all active:scale-95 ${
                                isSelected ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                              }`}
                            >
                              {isSelected ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                              {mate.displayName?.split(' ')[0]}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <input 
                          type="checkbox" 
                          id={`dialog-pantry-${idx}`} 
                          checked={item.addToPantry} 
                          onChange={() => toggleAddToPantry(idx)}
                          className="rounded border-gray-300 text-primary focus:ring-primary w-4 h-4 cursor-pointer"
                        />
                        <label htmlFor={`dialog-pantry-${idx}`} className="text-xs text-muted-foreground cursor-pointer select-none">
                          Add to Digital Pantry
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <div className="p-4 border-t bg-background sticky bottom-0">
                <Button className="w-full rounded-full" size="lg" onClick={submitParsedReceipt} disabled={loading}>
                  Save Items & Update Pantry
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showShoppingListDialog} onOpenChange={setShowShoppingListDialog}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>Shopping List Match</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              We found some items from your receipt that look like they cross off items from your shared "To Buy" list. Want to check them off?
            </p>
            <div className="space-y-2 border rounded-2xl bg-muted/30 p-2">
              {shoppingListMatches.map(match => {
                const isSelected = selectedMatchesToCheckout.includes(match.id);
                return (
                  <div key={match.id} className="flex items-center justify-between p-2 rounded-xl bg-card border">
                    <div>
                      <p className="text-sm font-medium">{match.name}</p>
                      <p className="text-xs text-muted-foreground">Matched: {match.matchedParsedItem}</p>
                    </div>
                    <div 
                      className={`h-5 w-5 rounded-full border-2 flex items-center justify-center cursor-pointer transition-colors ${
                        isSelected ? 'bg-primary border-primary' : 'border-muted-foreground hover:border-primary'
                      }`}
                      onClick={() => {
                        setSelectedMatchesToCheckout(prev => 
                          prev.includes(match.id) ? prev.filter(id => id !== match.id) : [...prev, match.id]
                        );
                      }}
                    >
                      {isSelected && <CheckCircle2 size={12} className="text-primary-foreground" />}
                    </div>
                  </div>
                );
              })}
            </div>
            <Button className="w-full rounded-full mt-2" onClick={finalSubmitParsedReceipt} disabled={isFinalizingSubmit}>
              {isFinalizingSubmit ? 'Finalizing...' : 'Confirm & Submit Receipt'}
            </Button>
            <Button variant="ghost" className="w-full rounded-full" onClick={() => {
              setSelectedMatchesToCheckout([]);
              setShowShoppingListDialog(false);
              finalSubmitParsedReceipt();
            }} disabled={isFinalizingSubmit}>
              Skip
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
