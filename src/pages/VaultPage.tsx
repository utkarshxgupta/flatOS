import { useState, useEffect } from 'react';
import { useAppContext } from '../AppContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, query, where, onSnapshot, doc, deleteDoc } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, Key, Link as LinkIcon, FileText, Trash2, Eye, EyeOff, Copy } from 'lucide-react';
import { toast } from 'sonner';

export default function VaultPage() {
  const { user, flatId } = useAppContext();
  const [items, setItems] = useState<any[]>([]);
  
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [type, setType] = useState<'password' | 'link' | 'text'>('password');
  const [loading, setLoading] = useState(false);
  const [visibleItems, setVisibleItems] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!flatId) return;

    const vaultQuery = query(collection(db, 'vault'), where('flatId', '==', flatId));
    const unsubVault = onSnapshot(vaultQuery, (snapshot) => {
      const v = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
      v.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setItems(v);
    });

    return () => unsubVault();
  }, [flatId]);

  const addItem = async () => {
    if (!user || !flatId || !title || !value) return;
    setLoading(true);
    try {
      await addDoc(collection(db, 'vault'), {
        flatId,
        title,
        value,
        type,
        addedBy: user.uid,
        createdAt: new Date().toISOString()
      });
      toast.success('Added to Vault!');
      setTitle('');
      setValue('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'vault');
      toast.error('Failed to add item');
    } finally {
      setLoading(false);
    }
  };

  const deleteItem = async (itemId: string) => {
    try {
      await deleteDoc(doc(db, 'vault', itemId));
      toast.success('Deleted');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `vault/${itemId}`);
      toast.error('Failed to delete');
    }
  };

  const toggleVisibility = (id: string) => {
    setVisibleItems(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const getIcon = (itemType: string) => {
    switch (itemType) {
      case 'password': return <Key size={18} className="text-amber-500" />;
      case 'link': return <LinkIcon size={18} className="text-blue-500" />;
      default: return <FileText size={18} className="text-green-500" />;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Shared Vault</h1>
        <p className="text-muted-foreground mt-1">Securely store WiFi passwords, lease links, and flat details.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Vault Items */}
        <div className="md:col-span-2 space-y-4">
          {items.map(item => (
            <Card key={item.id} className="rounded-2xl shadow-sm border-0 bg-card">
              <CardContent className="p-6 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                    {getIcon(item.type)}
                  </div>
                  <div>
                    <p className="font-medium">{item.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {item.type === 'password' && !visibleItems[item.id] ? (
                        <span className="text-sm font-mono text-muted-foreground">••••••••</span>
                      ) : item.type === 'link' ? (
                        <a href={item.value} target="_blank" rel="noreferrer" className="text-sm text-blue-500 hover:underline truncate max-w-[200px] block">
                          {item.value}
                        </a>
                      ) : (
                        <span className="text-sm font-mono text-muted-foreground">{item.value}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {item.type === 'password' && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => toggleVisibility(item.id)}>
                      {visibleItems[item.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => copyToClipboard(item.value)}>
                    <Copy size={16} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-500" onClick={() => deleteItem(item.id)}>
                    <Trash2 size={16} />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {items.length === 0 && (
            <p className="text-center text-muted-foreground py-8">Vault is empty.</p>
          )}
        </div>

        {/* Add Item */}
        <Card className="rounded-3xl shadow-sm border-0 bg-card h-fit">
          <CardHeader>
            <CardTitle className="text-lg font-medium flex items-center gap-2">
              <Shield size={18} /> Add to Vault
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input placeholder="e.g. WiFi Password" value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v: any) => setType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="password">Password / Secret</SelectItem>
                  <SelectItem value="link">URL / Link</SelectItem>
                  <SelectItem value="text">Plain Text</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Value</Label>
              <Input 
                type={type === 'password' ? 'password' : 'text'} 
                placeholder="Value..." 
                value={value} 
                onChange={e => setValue(e.target.value)} 
              />
            </div>
            <Button className="w-full rounded-full mt-2" onClick={addItem} disabled={loading || !title || !value}>
              Save Securely
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
