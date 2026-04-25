import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAppContext } from '../AppContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, onSnapshot, deleteDoc, doc, addDoc, updateDoc } from 'firebase/firestore';
import { suggestRecipes } from '../lib/gemini';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { ChefHat, Trash2, Leaf, AlertTriangle, Share2, Package, CheckCircle2, Plus, Camera, History, ShoppingCart, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { GoogleGenAI } from '@google/genai';
import { formatDistanceToNow } from 'date-fns';

export default function PantryPage() {
  const { flatId, user } = useAppContext();
  const [pantryItems, setPantryItems] = useState<any[]>([]);
  const [consumptionLogs, setConsumptionLogs] = useState<any[]>([]);
  const [shoppingList, setShoppingList] = useState<any[]>([]);
  const [flatmates, setFlatmates] = useState<any[]>([]);
  const [recipes, setRecipes] = useState<any[]>([]);
  const [loadingRecipes, setLoadingRecipes] = useState(false);
  const [selectedRecipe, setSelectedRecipe] = useState<any>(null);

  const [isManualAddOpen, setIsManualAddOpen] = useState(false);
  const [manualItem, setManualItem] = useState({ name: '', quantity: '1', unit: 'unit', category: 'Groceries', healthTag: '', emojis: '' });
  const [isAddingManual, setIsAddingManual] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [newItemForCart, setNewItemForCart] = useState('');
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleManualAdd = async () => {
    if (!user || !flatId || !manualItem.name.trim()) return;
    setIsAddingManual(true);
    try {
      const normalizedNewName = manualItem.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const matchedItem = pantryItems.find(existing => {
        const normalizedExisting = existing.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        return normalizedExisting.includes(normalizedNewName) || normalizedNewName.includes(normalizedExisting);
      });

      const newHistoryEntry = { quantity: manualItem.quantity + ' ' + manualItem.unit, date: new Date().toISOString() };

      if (matchedItem) {
        const parsedExisting = parseQuantity(matchedItem.quantity);
        const parsedNew = parseQuantity(newHistoryEntry.quantity);
        const newQuantity = (parsedExisting.unit === parsedNew.unit) 
          ? `${parsedExisting.val + parsedNew.val} ${parsedExisting.unit}`.trim()
          : `${matchedItem.quantity} + ${newHistoryEntry.quantity}`;
        
        const newHistory = matchedItem.history ? [...matchedItem.history, newHistoryEntry] : [
          { quantity: matchedItem.quantity, date: matchedItem.dateAdded },
          newHistoryEntry
        ];

        await updateDoc(doc(db, 'pantryItems', matchedItem.id), {
          quantity: newQuantity,
          dateAdded: new Date().toISOString(),
          history: newHistory,
          emojis: matchedItem.emojis || manualItem.emojis || ''
        });
      } else {
        await addDoc(collection(db, 'pantryItems'), {
          flatId,
          name: manualItem.name,
          quantity: newHistoryEntry.quantity,
          unit: manualItem.unit,
          category: manualItem.category,
          healthTag: manualItem.healthTag,
          emojis: manualItem.emojis || '',
          addedBy: user.uid,
          dateAdded: new Date().toISOString(),
          history: [newHistoryEntry]
        });
      }
      toast.success('Item added to pantry');
      setIsManualAddOpen(false);
      setManualItem({ name: '', quantity: '1', unit: 'unit', category: 'Groceries', healthTag: '', emojis: '' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'pantryItems');
      toast.error('Failed to add item');
    } finally {
      setIsAddingManual(false);
    }
  };

  const handleAddShoppingItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !flatId || !newItemForCart.trim()) return;
    
    setIsAddingToCart(true);
    try {
      await addDoc(collection(db, 'shoppingList'), {
        flatId,
        name: newItemForCart.trim(),
        addedBy: user.uid,
        dateAdded: new Date().toISOString()
      });
      setNewItemForCart('');
      toast.success('Added to shopping list');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'shoppingList');
      toast.error('Failed to add item');
    } finally {
      setIsAddingToCart(false);
    }
  };

  const handleDeleteShoppingItem = async (itemId: string) => {
    try {
      await deleteDoc(doc(db, 'shoppingList', itemId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `shoppingList/${itemId}`);
      toast.error('Failed to remove item');
    }
  };

  const handleScanImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsScanning(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64String = (reader.result as string).split(',')[1];
        
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    data: base64String,
                    mimeType: file.type
                  }
                },
                {
                  text: `Analyze this image of a grocery or pantry item. Return a JSON object with the following keys:
- name: string (the name of the item)
- quantity: string (the numeric amount, e.g., "1", "500")
- unit: string (the unit, e.g., "unit", "g", "ml", "kg")
- category: string (e.g., "Groceries", "Produce", "Dairy", "Snacks")
- healthTag: string (e.g., "Fresh Produce", "High Sugar", "Processed", "Healthy Fats", "Protein", or empty string if none apply)
- emojis: string (Suggest up to 3 emojis to visually describe this item)
Only return the JSON object, no markdown formatting.`
                }
              ]
            }
          ],
          config: {
            responseMimeType: "application/json",
          }
        });

        if (response.text) {
          try {
            const parsed = JSON.parse(response.text);
            setManualItem({
              name: parsed.name || '',
              quantity: parsed.quantity || '1',
              unit: parsed.unit || 'unit',
              category: parsed.category || 'Groceries',
              healthTag: parsed.healthTag || '',
              emojis: parsed.emojis || ''
            });
            toast.success('Item scanned successfully!');
          } catch (e) {
            toast.error('Failed to parse scanned item');
          }
        }
      };
      reader.readAsDataURL(file);
    } catch (error) {
      toast.error('Failed to scan image');
    } finally {
      setIsScanning(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  useEffect(() => {
    if (!flatId) return;

    const pantryQuery = query(collection(db, 'pantryItems'), where('flatId', '==', flatId));
    const unsubPantry = onSnapshot(pantryQuery, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
      items.sort((a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime());
      setPantryItems(items);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'pantryItems'));

    const logQuery = query(collection(db, 'consumptionLogs'), where('flatId', '==', flatId));
    const unsubLogs = onSnapshot(logQuery, (snapshot) => {
      const logs = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
      logs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setConsumptionLogs(logs);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'consumptionLogs'));

    const shoppingQuery = query(collection(db, 'shoppingList'), where('flatId', '==', flatId));
    const unsubShopping = onSnapshot(shoppingQuery, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
      list.sort((a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime());
      setShoppingList(list);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'shoppingList'));

    const usersQuery = query(collection(db, 'users'), where('flatId', '==', flatId));
    const unsubUsers = onSnapshot(usersQuery, (snapshot) => {
      const users = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
      setFlatmates(users);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'users'));

    return () => {
      unsubPantry();
      unsubLogs();
      unsubShopping();
      unsubUsers();
    };
  }, [flatId]);

  const deleteItem = async (itemId: string) => {
    try {
      await deleteDoc(doc(db, 'pantryItems', itemId));
      toast.success('Item removed from pantry');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `pantryItems/${itemId}`);
      toast.error('Failed to remove item');
    }
  };

  const [consumingItem, setConsumingItem] = useState<any | null>(null);
  const [consumePercentage, setConsumePercentage] = useState<number>(100);
  const [isConsuming, setIsConsuming] = useState(false);

  const parseQuantity = (q: string) => {
    const match = q.toString().toLowerCase().match(/([\d.]+)\s*([a-zA-Z]+)?/);
    if (match) return { val: parseFloat(match[1]), unit: match[2] || '' };
    return { val: 1, unit: 'unit' };
  };

  const handleConsume = async () => {
    if (!user || !flatId || !consumingItem) return;
    setIsConsuming(true);
    try {
      const parsed = parseQuantity(consumingItem.quantity);
      const consumedVal = (parsed.val * consumePercentage) / 100;
      const consumedQtyString = `${consumedVal} ${parsed.unit}`.trim();
      
      // Log consumption
      await addDoc(collection(db, 'consumptionLogs'), {
        flatId,
        userId: user.uid,
        itemName: consumingItem.name,
        quantity: consumedQtyString,
        healthTag: consumingItem.healthTag || '',
        category: consumingItem.category || '',
        date: new Date().toISOString()
      });
      
      if (consumePercentage === 100) {
        // Remove from pantry
        await deleteDoc(doc(db, 'pantryItems', consumingItem.id));
      } else {
        // Update remaining quantity
        const remainingVal = parsed.val - consumedVal;
        const remainingQtyString = `${remainingVal} ${parsed.unit}`.trim();
        await updateDoc(doc(db, 'pantryItems', consumingItem.id), {
          quantity: remainingQtyString
        });
      }
      toast.success(`${consumingItem.name} consumed!`);
      setConsumingItem(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `pantryItems/${consumingItem.id}`);
      toast.error('Failed to mark item as consumed');
    } finally {
      setIsConsuming(false);
    }
  };

  const consumeItem = async (item: any) => {
    setConsumingItem(item);
    setConsumePercentage(100);
  };

  const generateRecipes = async () => {
    if (pantryItems.length === 0) {
      toast.error('Your pantry is empty!');
      return;
    }
    setLoadingRecipes(true);
    try {
      const itemNames = pantryItems.map(item => item.name);
      const suggestions = await suggestRecipes(itemNames);
      setRecipes(suggestions);
      toast.success('Recipes generated!');
    } catch (error) {
      toast.error('Failed to generate recipes');
    } finally {
      setLoadingRecipes(false);
    }
  };

  const shareToWhatsApp = (recipe: any) => {
    const text = `*${recipe.name}*\n\n*Ingredients:* ${recipe.ingredientsToUse.join(', ')}\n\n*Instructions:*\n${recipe.instructions}`;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  const [mobileView, setMobileView] = useState<'pantry' | 'tobuy' | 'meals'>('pantry');

  // Calculate Health Score (Ratio of Fresh Produce to High Sugar/Processed)
  const freshCount = pantryItems.filter(i => i.healthTag?.toLowerCase().includes('fresh')).length;
  const sugarCount = pantryItems.filter(i => i.healthTag?.toLowerCase().includes('sugar') || i.healthTag?.toLowerCase().includes('processed')).length;
  const totalTagged = freshCount + sugarCount;
  const healthScore = totalTagged === 0 ? 100 : Math.round((freshCount / totalTagged) * 100);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Digital Pantry</h1>
          <p className="text-muted-foreground mt-1.5 text-sm sm:text-base">Auto-stocked from your receipts.</p>
        </div>
      </div>

      {/* Mobile Navigation Segment Control */}
      <div className="lg:hidden flex p-1 bg-muted/70 rounded-2xl shadow-inner">
        <button 
          onClick={() => setMobileView('pantry')} 
          className={`flex-1 py-2.5 rounded-xl whitespace-nowrap text-xs sm:text-sm font-semibold transition-all duration-200 ease-in-out ${mobileView === 'pantry' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
        >
          Inventory
        </button>
        <button 
          onClick={() => setMobileView('tobuy')} 
          className={`flex-1 py-2.5 rounded-xl whitespace-nowrap text-xs sm:text-sm font-semibold transition-all duration-200 ease-in-out flex items-center justify-center gap-1.5 ${mobileView === 'tobuy' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
        >
          To Buy {shoppingList.length > 0 && <span className="bg-primary/10 text-primary text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold">{shoppingList.length}</span>}
        </button>
        <button 
          onClick={() => setMobileView('meals')} 
          className={`flex-1 py-2.5 rounded-xl whitespace-nowrap text-xs sm:text-sm font-semibold transition-all duration-200 ease-in-out ${mobileView === 'meals' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
        >
          Meals & Health
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Inventory and History */}
        <div className="lg:col-span-2 space-y-6 flex flex-col">
          {/* Inventory List */}
          <Card className={`rounded-3xl shadow-sm border-0 bg-card ${mobileView === 'pantry' ? 'block' : 'hidden'} lg:block`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg font-medium">Current Stock</CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono">{pantryItems.length} items</Badge>
                <Button variant="outline" size="sm" className="h-8 text-xs rounded-full bg-primary/5 border-primary/20 hover:bg-primary/10 text-primary" onClick={() => setIsManualAddOpen(true)}>
                  <Plus size={14} className="mr-1" /> Add
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px] pr-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pb-2">
                  {pantryItems.map(item => {
                    let originalQtyStr = null;
                    if (item.history && item.history.length > 0) {
                      let totalVal = 0;
                      let commonUnit = '';
                      item.history.forEach((h: any) => {
                        const match = h.quantity.toString().toLowerCase().match(/([\d.]+)\s*([a-zA-Z]+)?/);
                        if (match) {
                          totalVal += parseFloat(match[1]);
                          commonUnit = match[2] || '';
                        }
                      });
                      
                      const currentMatch = item.quantity.toString().toLowerCase().match(/([\d.]+)\s*([a-zA-Z]+)?/);
                      if (currentMatch) {
                        const currentVal = parseFloat(currentMatch[1]);
                        if (Math.abs(totalVal - currentVal) > 0.01) {
                          originalQtyStr = `${totalVal} ${commonUnit}`.trim();
                        }
                      }
                    }

                    const isExpanded = expandedItemId === item.id;
                    const displayEmoji = item.emojis ? item.emojis.substring(0, 5) : '📦';

                    return (
                      <div 
                        key={item.id} 
                        className={`group flex flex-col p-3 rounded-[1.25rem] border border-border/50 cursor-pointer transition-all duration-200 ${isExpanded ? 'col-span-2 sm:col-span-3 md:col-span-4 bg-muted/30 shadow-md ring-1 ring-border' : 'bg-card shadow-sm hover:shadow-md hover:border-primary/20'}`}
                        onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className={`flex items-center justify-center rounded-xl bg-muted/50 ${isExpanded ? 'w-12 h-12 text-3xl mb-1' : 'w-10 h-10 text-2xl'}`}>
                            {displayEmoji}
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className="text-[11px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                              {item.quantity}
                            </span>
                            {originalQtyStr && !isExpanded && (
                              <span className="text-[9px] line-through text-muted-foreground opacity-70 px-1">
                                {originalQtyStr}
                              </span>
                            )}
                          </div>
                        </div>

                        <p className={`font-semibold mt-2 text-foreground/90 ${isExpanded ? 'text-lg break-words leading-tight' : 'text-sm truncate'}`}>
                          {item.name}
                        </p>

                        {isExpanded && (
                          <div className="mt-4 pt-3 border-t border-border/60 flex flex-col gap-4 animate-in slide-in-from-top-2 fade-in duration-200" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-between">
                              {item.healthTag ? (
                                <Badge variant="secondary" className={`text-xs px-2.5 py-1 rounded-full border-0 ${
                                  item.healthTag.toLowerCase().includes('fresh') ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 
                                  item.healthTag.toLowerCase().includes('sugar') ? 'bg-red-500/10 text-red-700 dark:text-red-400' : ''
                                }`}>
                                  {item.healthTag}
                                </Badge>
                              ) : <span className="text-xs text-muted-foreground">No health tags</span>}
                              
                              {originalQtyStr && (
                                <span className="text-xs text-muted-foreground">
                                  Originally <span className="font-medium line-through opacity-70">{originalQtyStr}</span>
                                </span>
                              )}
                            </div>
                            
                            {item.history && item.history.length > 0 && (
                              <div className="text-xs text-muted-foreground bg-background/50 p-3 rounded-xl border border-border/50">
                                <p className="font-semibold text-foreground/80 mb-2">Restock History</p>
                                <div className="space-y-1.5 flex flex-col max-h-[100px] overflow-y-auto no-scrollbar">
                                  {item.history.map((h: any, i: number) => (
                                    <div key={i} className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40"></span>
                                        {h.quantity}
                                      </div>
                                      <span className="text-muted-foreground/60">{new Date(h.date).toLocaleDateString()}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className="flex items-center gap-3 mt-1">
                              <Button variant="secondary" className="h-10 flex-1 text-green-700 hover:text-green-800 bg-green-500/10 hover:bg-green-500/20 dark:text-green-400 border-0 shadow-none font-semibold rounded-xl" onClick={(e) => { e.stopPropagation(); consumeItem(item); }}>
                                <CheckCircle2 size={18} className="mr-2" /> Consume
                              </Button>
                              <Button variant="outline" size="icon" className="h-10 w-10 text-muted-foreground hover:bg-red-500/10 hover:text-red-600 border-border/50 hover:border-red-200 shrink-0 rounded-xl" onClick={(e) => { e.stopPropagation(); deleteItem(item.id); }}>
                                <Trash2 size={18} />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {pantryItems.length === 0 && (
                    <div className="col-span-full text-center py-12 text-muted-foreground">
                      <Package size={48} className="mx-auto mb-4 opacity-20" />
                      <p>Pantry is empty.</p>
                      <p className="text-sm mt-1">Upload a receipt in Expenses to auto-stock.</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Consumption History */}
          <Card className={`rounded-3xl shadow-sm border-0 bg-card ${mobileView === 'pantry' ? 'block' : 'hidden'} lg:block`}>
            <CardHeader>
              <CardTitle className="text-lg font-medium flex items-center gap-2">
                <History size={18} /> Consumption Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px] pr-4">
                <div className="space-y-4">
                  {consumptionLogs.map((log) => {
                    const mate = flatmates.find(m => m.id === log.userId);
                    return (
                      <div key={log.id} className="flex items-start gap-4 p-4 rounded-2xl bg-muted/20 border border-border/40 hover:bg-muted/40 transition-colors">
                        <Avatar className="h-10 w-10 mt-0.5 shadow-sm border border-border/50">
                          <AvatarImage src={mate?.photoURL} />
                          <AvatarFallback className="bg-primary/5 text-primary">
                            {mate?.displayName?.charAt(0) || <History size={16} />}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 space-y-1">
                          <p className="leading-snug text-sm">
                            <span className="font-semibold text-foreground">{mate?.displayName || 'Someone'}</span> consumed <span className="font-medium">{log.itemName}</span>
                            {log.quantity && <span className="font-mono text-muted-foreground bg-background border border-border/50 shadow-sm px-1.5 py-0.5 rounded-md ml-1.5 text-[11px] font-medium">{log.quantity}</span>}
                          </p>
                          <p className="text-[11px] font-medium text-muted-foreground/70 flex items-center gap-2">
                            {formatDistanceToNow(new Date(log.date), { addSuffix: true })}
                            {log.healthTag && (
                              <span className="inline-flex items-center">
                                <span className="w-1 h-1 rounded-full bg-border mx-1.5"></span>
                                <span className="uppercase tracking-wider">{log.healthTag}</span>
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  {consumptionLogs.length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                      <History size={48} className="mx-auto mb-4 opacity-20" />
                      <p>No consumption logs yet.</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
          
          {/* Recipe Results */}
          {recipes.length > 0 && (
            <div className={`space-y-4 pt-4 ${mobileView === 'meals' ? 'block' : 'hidden'} lg:block`}>
              <h3 className="text-xl font-semibold tracking-tight leading-none mb-1">Suggested Menu</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {recipes.map((recipe, idx) => (
                  <Card 
                    key={idx} 
                    className="rounded-3xl shadow-sm border-0 bg-card cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
                    onClick={() => setSelectedRecipe(recipe)}
                  >
                    <CardContent className="p-6 flex flex-col h-full gap-3">
                      <h4 className="font-semibold mb-2">{recipe.name}</h4>
                      <p className="text-xs text-muted-foreground mb-4 flex-1">
                        Uses: {recipe.ingredientsToUse.join(', ')}
                      </p>
                      <Button variant="outline" className="w-full rounded-full text-xs h-8" onClick={(e) => { e.stopPropagation(); shareToWhatsApp(recipe); }}>
                        <Share2 size={14} className="mr-2" /> Forward to Cook
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: To Buy, Health, Recipes */}
        <div className="space-y-6 flex flex-col">
          
          {/* Shopping List */}
          <Card className={`rounded-3xl shadow-sm border-0 bg-card ${mobileView === 'tobuy' ? 'block' : 'hidden'} lg:block`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg font-medium flex items-center gap-2">
                <ShoppingCart size={18} /> Shared To Buy List
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAddShoppingItem} className="flex items-center gap-2 mb-6">
                <Input 
                  placeholder="E.g., Milk, Eggs..." 
                  value={newItemForCart}
                  onChange={(e) => setNewItemForCart(e.target.value)}
                  className="rounded-full bg-muted border-0 h-10"
                />
                <Button type="submit" disabled={isAddingToCart || !newItemForCart.trim()} className="rounded-full h-10 w-10 p-0 flex-shrink-0">
                  <Plus size={18} />
                </Button>
              </form>

              <ScrollArea className="h-[250px] pr-2">
                <div className="space-y-2">
                  {shoppingList.map((item) => (
                    <div 
                      key={item.id} 
                      className="group flex items-center justify-between p-3.5 rounded-2xl bg-muted/30 border border-border/50 hover:bg-muted/60 transition-all hover:border-border/80 cursor-pointer"
                      onClick={() => handleDeleteShoppingItem(item.id)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/50 group-hover:border-primary group-hover:bg-primary/10 flex items-center justify-center transition-all"></div>
                        <span className="text-sm font-medium">{item.name}</span>
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-500 md:opacity-0 md:group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); handleDeleteShoppingItem(item.id); }}>
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  ))}
                  
                  {shoppingList.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      <ShoppingCart size={32} className="mx-auto mb-2 opacity-20" />
                      <p className="text-sm">Shopping list is empty.</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Health Score */}
          <Card className={`rounded-3xl shadow-sm border-0 bg-card ${mobileView === 'meals' ? 'block' : 'hidden'} lg:block`}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-medium">Household Health</h3>
                {healthScore >= 70 ? <Leaf className="text-green-500" size={20} /> : <AlertTriangle className="text-orange-500" size={20} />}
              </div>
              <div className="flex items-end gap-2 mb-2">
                <span className="text-4xl font-light tracking-tight">{healthScore}</span>
                <span className="text-muted-foreground mb-1">/ 100</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2 mb-2">
                <div className={`h-2 rounded-full ${healthScore >= 70 ? 'bg-green-500' : healthScore >= 40 ? 'bg-orange-500' : 'bg-red-500'}`} style={{ width: `${healthScore}%` }}></div>
              </div>
              <p className="text-xs text-muted-foreground">Based on ratio of fresh produce to processed items.</p>
            </CardContent>
          </Card>

          {/* Recipe Engine */}
          <Card className={`rounded-3xl shadow-sm border-0 bg-primary text-primary-foreground overflow-hidden relative ${mobileView === 'meals' ? 'block' : 'hidden'} lg:block`}>
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <ChefHat size={80} />
            </div>
            <CardContent className="pt-6 relative z-10">
              <h3 className="font-semibold text-lg mb-2">Reverse Recipe Engine</h3>
              <p className="text-sm text-primary-foreground/80 mb-6">
                Don't know what to cook? Let AI suggest meals based on what's already in your pantry.
              </p>
              <Button 
                variant="secondary" 
                className="w-full rounded-full font-medium" 
                onClick={generateRecipes}
                disabled={loadingRecipes || pantryItems.length === 0}
              >
                {loadingRecipes ? 'Thinking...' : 'Generate Menu'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recipe Details Dialog */}
      <Dialog open={!!selectedRecipe} onOpenChange={(open) => !open && setSelectedRecipe(null)}>
        <DialogContent className="sm:max-w-lg rounded-3xl">
          <DialogHeader>
            <DialogTitle>{selectedRecipe?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <h4 className="font-semibold text-sm mb-2">Ingredients from Pantry</h4>
              <div className="flex flex-wrap gap-2">
                {selectedRecipe?.ingredientsToUse.map((ing: string, i: number) => (
                  <Badge key={i} variant="secondary">{ing}</Badge>
                ))}
              </div>
            </div>
            <div>
              <h4 className="font-semibold text-sm mb-2">Instructions</h4>
              <div className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted/50 p-4 rounded-2xl">
                {selectedRecipe?.instructions}
              </div>
            </div>
            <Button className="w-full rounded-full" onClick={() => shareToWhatsApp(selectedRecipe)}>
              <Share2 size={16} className="mr-2" /> Forward to Cook
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!consumingItem} onOpenChange={(open) => !open && setConsumingItem(null)}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>Consume {consumingItem?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <Label>How much did you consume?</Label>
                <span className="font-medium text-primary">{consumePercentage}%</span>
              </div>
              <input 
                type="range"
                value={consumePercentage} 
                onChange={(e) => setConsumePercentage(Number(e.target.value))} 
                max={100} 
                step={25} 
                className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
              />
              <div className="flex justify-between text-xs text-muted-foreground px-1">
                <span>0%</span>
                <span>25%</span>
                <span>50%</span>
                <span>75%</span>
                <span>All</span>
              </div>
            </div>
            <Button className="w-full rounded-full" onClick={handleConsume} disabled={isConsuming || consumePercentage === 0}>
              {isConsuming ? 'Logging...' : 'Log Consumption'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={isManualAddOpen} onOpenChange={setIsManualAddOpen}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>Add Item Manually</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex justify-center mb-4">
              <input 
                type="file" 
                accept="image/*" 
                capture="environment" 
                className="hidden" 
                ref={fileInputRef}
                onChange={handleScanImage}
              />
              <Button 
                variant="outline" 
                className="w-full h-20 border-dashed rounded-2xl flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-primary hover:border-primary hover:bg-primary/5"
                onClick={() => fileInputRef.current?.click()}
                disabled={isScanning}
              >
                <Camera size={24} />
                <span className="text-sm font-medium">{isScanning ? 'Scanning...' : 'Scan with Camera to Auto-fill'}</span>
              </Button>
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="itemName">Item Name</Label>
              <Input id="itemName" value={manualItem.name} onChange={e => setManualItem({...manualItem, name: e.target.value})} placeholder="e.g. Milk" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="itemEmojis">Emoji Icon</Label>
                <Input id="itemEmojis" value={manualItem.emojis} onChange={e => setManualItem({...manualItem, emojis: e.target.value})} placeholder="e.g. 🥛" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="itemCategory">Category</Label>
                <Input id="itemCategory" value={manualItem.category} onChange={e => setManualItem({...manualItem, category: e.target.value})} placeholder="e.g. Dairy" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="itemQty">Quantity</Label>
                <Input id="itemQty" type="number" value={manualItem.quantity} onChange={e => setManualItem({...manualItem, quantity: e.target.value})} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="itemUnit">Unit</Label>
                <Input id="itemUnit" value={manualItem.unit} onChange={e => setManualItem({...manualItem, unit: e.target.value})} placeholder="e.g. L, kg, unit" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="itemHealth">Health Tag (Optional)</Label>
              <Select value={manualItem.healthTag} onValueChange={v => setManualItem({...manualItem, healthTag: v === 'none' ? '' : v})}>
                <SelectTrigger id="itemHealth">
                  <SelectValue placeholder="Select a health tag" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="Fresh Produce">Fresh Produce</SelectItem>
                  <SelectItem value="Protein">Protein</SelectItem>
                  <SelectItem value="Healthy Fats">Healthy Fats</SelectItem>
                  <SelectItem value="Processed">Processed</SelectItem>
                  <SelectItem value="High Sugar">High Sugar</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full rounded-full mt-2" onClick={handleManualAdd} disabled={isAddingManual || !manualItem.name.trim()}>
              {isAddingManual ? 'Adding...' : 'Add to Pantry'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
