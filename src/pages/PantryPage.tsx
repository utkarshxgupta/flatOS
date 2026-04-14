import { useState, useEffect } from 'react';
import { useAppContext } from '../AppContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, onSnapshot, deleteDoc, doc, addDoc } from 'firebase/firestore';
import { suggestRecipes } from '../lib/gemini';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChefHat, Trash2, Leaf, AlertTriangle, Share2, Package, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

export default function PantryPage() {
  const { flatId, user } = useAppContext();
  const [pantryItems, setPantryItems] = useState<any[]>([]);
  const [recipes, setRecipes] = useState<any[]>([]);
  const [loadingRecipes, setLoadingRecipes] = useState(false);
  const [selectedRecipe, setSelectedRecipe] = useState<any>(null);

  useEffect(() => {
    if (!flatId) return;

    const pantryQuery = query(collection(db, 'pantryItems'), where('flatId', '==', flatId));
    const unsubPantry = onSnapshot(pantryQuery, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
      items.sort((a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime());
      setPantryItems(items);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'pantryItems'));

    return () => unsubPantry();
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

  const consumeItem = async (item: any) => {
    if (!user || !flatId) return;
    try {
      // Log consumption
      await addDoc(collection(db, 'consumptionLogs'), {
        flatId,
        userId: user.uid,
        itemName: item.name,
        quantity: item.quantity,
        date: new Date().toISOString()
      });
      
      // Remove from pantry
      await deleteDoc(doc(db, 'pantryItems', item.id));
      toast.success(`${item.name} marked as consumed!`);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `pantryItems/${item.id}`);
      toast.error('Failed to mark item as consumed');
    }
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

  // Calculate Health Score (Ratio of Fresh Produce to High Sugar/Processed)
  const freshCount = pantryItems.filter(i => i.healthTag?.toLowerCase().includes('fresh')).length;
  const sugarCount = pantryItems.filter(i => i.healthTag?.toLowerCase().includes('sugar') || i.healthTag?.toLowerCase().includes('processed')).length;
  const totalTagged = freshCount + sugarCount;
  const healthScore = totalTagged === 0 ? 100 : Math.round((freshCount / totalTagged) * 100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Digital Pantry</h1>
        <p className="text-muted-foreground mt-1">Auto-stocked from your receipts.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Inventory List */}
        <Card className="rounded-3xl shadow-sm border-0 bg-card md:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg font-medium">Current Stock</CardTitle>
            <Badge variant="outline" className="font-mono">{pantryItems.length} items</Badge>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-3">
                {pantryItems.map(item => (
                  <div key={item.id} className="flex items-center justify-between p-3 rounded-2xl bg-muted/50 border border-border">
                    <div>
                      <p className="font-medium text-sm">{item.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">Qty: {item.quantity}</span>
                        {item.healthTag && (
                          <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${
                            item.healthTag.toLowerCase().includes('fresh') ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 
                            item.healthTag.toLowerCase().includes('sugar') ? 'bg-red-500/10 text-red-600 dark:text-red-400' : ''
                          }`}>
                            {item.healthTag}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20" onClick={() => consumeItem(item)}>
                        <CheckCircle2 size={14} className="mr-1" /> Consume
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-500" onClick={() => deleteItem(item.id)}>
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </div>
                ))}
                {pantryItems.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    <Package size={48} className="mx-auto mb-4 opacity-20" />
                    <p>Pantry is empty.</p>
                    <p className="text-sm mt-1">Upload a receipt in Expenses to auto-stock.</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {/* Health Score */}
          <Card className="rounded-3xl shadow-sm border-0 bg-card">
            <CardContent className="p-6">
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
          <Card className="rounded-3xl shadow-sm border-0 bg-primary text-primary-foreground overflow-hidden relative">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <ChefHat size={80} />
            </div>
            <CardContent className="p-6 relative z-10">
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

      {/* Recipe Results */}
      {recipes.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-xl font-semibold tracking-tight">Suggested Menu</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {recipes.map((recipe, idx) => (
              <Card 
                key={idx} 
                className="rounded-3xl shadow-sm border-0 bg-card cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all"
                onClick={() => setSelectedRecipe(recipe)}
              >
                <CardContent className="p-5 flex flex-col h-full">
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
    </div>
  );
}
