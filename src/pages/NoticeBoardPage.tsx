import { useState, useEffect } from 'react';
import { useAppContext } from '../AppContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, query, where, onSnapshot, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { MessageSquare, BarChart2, Trash2, Send, Heart } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

export default function NoticeBoardPage() {
  const { user, flatId } = useAppContext();
  const [notices, setNotices] = useState<any[]>([]);
  const [flatmates, setFlatmates] = useState<any[]>([]);
  
  const [content, setContent] = useState('');
  const [type, setType] = useState<'announcement' | 'poll'>('announcement');
  const [options, setOptions] = useState(['', '']);
  const [loading, setLoading] = useState(false);
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!flatId) return;

    const usersQuery = query(collection(db, 'users'), where('flatId', '==', flatId));
    const unsubUsers = onSnapshot(usersQuery, (snapshot) => {
      setFlatmates(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const noticesQuery = query(collection(db, 'notices'), where('flatId', '==', flatId));
    const unsubNotices = onSnapshot(noticesQuery, (snapshot) => {
      const n = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as any) }));
      n.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setNotices(n);
    });

    return () => {
      unsubUsers();
      unsubNotices();
    };
  }, [flatId]);

  const postNotice = async () => {
    if (!user || !flatId || !content) return;
    
    let validOptions = options.filter(o => o.trim() !== '');
    if (type === 'poll' && validOptions.length < 2) {
      toast.error('Polls need at least 2 options');
      return;
    }

    setLoading(true);
    try {
      await addDoc(collection(db, 'notices'), {
        flatId,
        authorId: user.uid,
        content,
        type,
        options: type === 'poll' ? validOptions : null,
        votes: type === 'poll' ? {} : null,
        createdAt: new Date().toISOString()
      });
      toast.success('Posted to Notice Board!');
      setContent('');
      setOptions(['', '']);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'notices');
      toast.error('Failed to post');
    } finally {
      setLoading(false);
    }
  };

  const votePoll = async (noticeId: string, optionIndex: number) => {
    if (!user) return;
    const notice = notices.find(n => n.id === noticeId);
    if (!notice) return;

    try {
      const newVotes = { ...(notice.votes || {}) };
      newVotes[user.uid] = optionIndex;
      await updateDoc(doc(db, 'notices', noticeId), { votes: newVotes });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `notices/${noticeId}`);
      toast.error('Failed to vote');
    }
  };

  const toggleLike = async (noticeId: string) => {
    if (!user) return;
    const notice = notices.find(n => n.id === noticeId);
    if (!notice) return;

    try {
      const likes = notice.likes || [];
      const newLikes = likes.includes(user.uid) 
        ? likes.filter((id: string) => id !== user.uid)
        : [...likes, user.uid];
      
      await updateDoc(doc(db, 'notices', noticeId), { likes: newLikes });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `notices/${noticeId}`);
      toast.error('Failed to like');
    }
  };

  const addComment = async (noticeId: string, commentContent: string) => {
    if (!user || !commentContent.trim()) return;
    const notice = notices.find(n => n.id === noticeId);
    if (!notice) return;

    try {
      const newComment = {
        id: Math.random().toString(36).substring(2, 9),
        authorId: user.uid,
        content: commentContent.trim(),
        createdAt: new Date().toISOString()
      };
      const newComments = [...(notice.comments || []), newComment];
      
      await updateDoc(doc(db, 'notices', noticeId), { comments: newComments });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `notices/${noticeId}`);
      toast.error('Failed to add comment');
    }
  };

  const deleteNotice = async (noticeId: string) => {
    try {
      await deleteDoc(doc(db, 'notices', noticeId));
      toast.success('Deleted');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `notices/${noticeId}`);
      toast.error('Failed to delete');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Notice Board</h1>
        <p className="text-muted-foreground mt-1">Announcements and polls for the flat.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Feed */}
        <div className="md:col-span-2 space-y-4">
          {notices.map(notice => {
            const author = flatmates.find(m => m.id === notice.authorId);
            return (
              <Card key={notice.id} className="rounded-3xl shadow-sm border-0 bg-card">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={author?.photoURL} />
                        <AvatarFallback>{author?.displayName?.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium text-sm">{author?.displayName}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(notice.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                    {notice.authorId === user?.uid && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-500" onClick={() => deleteNotice(notice.id)}>
                        <Trash2 size={16} />
                      </Button>
                    )}
                  </div>
                  
                  <p className="text-foreground whitespace-pre-wrap">{notice.content}</p>

                  {notice.type === 'poll' && notice.options && (
                    <div className="mt-4 space-y-2">
                      {notice.options.map((opt: string, idx: number) => {
                        const votes = Object.values(notice.votes || {}).filter(v => v === idx).length;
                        const totalVotes = Object.keys(notice.votes || {}).length;
                        const percent = totalVotes === 0 ? 0 : Math.round((votes / totalVotes) * 100);
                        const hasVotedForThis = notice.votes?.[user?.uid || ''] === idx;

                        return (
                          <div 
                            key={idx} 
                            onClick={() => votePoll(notice.id, idx)}
                            className={`relative overflow-hidden rounded-xl border p-3 cursor-pointer transition-colors ${hasVotedForThis ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
                          >
                            <div 
                              className="absolute left-0 top-0 bottom-0 bg-primary/10 transition-all" 
                              style={{ width: `${percent}%` }}
                            />
                            <div className="relative flex justify-between items-center z-10 text-sm">
                              <span className={hasVotedForThis ? 'font-medium' : ''}>{opt}</span>
                              <span className="text-muted-foreground">{percent}% ({votes})</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="mt-4 pt-4 border-t flex items-center gap-4">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className={`h-8 px-2 ${notice.likes?.includes(user?.uid || '') ? 'text-red-500 hover:text-red-600' : 'text-muted-foreground hover:text-red-500'}`}
                      onClick={() => toggleLike(notice.id)}
                    >
                      <Heart size={16} className={`mr-1.5 ${notice.likes?.includes(user?.uid || '') ? 'fill-current' : ''}`} />
                      {notice.likes?.length || 0}
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 px-2 text-muted-foreground hover:text-primary"
                      onClick={() => setExpandedComments(prev => ({ ...prev, [notice.id]: !prev[notice.id] }))}
                    >
                      <MessageSquare size={16} className="mr-1.5" />
                      {notice.comments?.length || 0}
                    </Button>
                  </div>

                  {expandedComments[notice.id] && (
                    <div className="mt-4 space-y-4">
                      {notice.comments?.map((comment: any) => {
                        const commentAuthor = flatmates.find(m => m.id === comment.authorId);
                        return (
                          <div key={comment.id} className="flex gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={commentAuthor?.photoURL} />
                              <AvatarFallback>{commentAuthor?.displayName?.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 bg-muted/50 p-3 rounded-2xl rounded-tl-none">
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-medium text-sm">{commentAuthor?.displayName}</span>
                                <span className="text-[10px] text-muted-foreground">
                                  {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                                </span>
                              </div>
                              <p className="text-sm text-foreground">{comment.content}</p>
                            </div>
                          </div>
                        );
                      })}

                      <div className="flex gap-2 items-center mt-2">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={user?.photoURL || ''} />
                          <AvatarFallback>{user?.displayName?.charAt(0) || 'U'}</AvatarFallback>
                        </Avatar>
                        <Input 
                          placeholder="Write a comment..." 
                          className="flex-1 h-9 rounded-full bg-muted/50 border-transparent focus-visible:ring-1"
                          value={commentInputs[notice.id] || ''}
                          onChange={(e) => setCommentInputs(prev => ({ ...prev, [notice.id]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              addComment(notice.id, commentInputs[notice.id] || '');
                              setCommentInputs(prev => ({ ...prev, [notice.id]: '' }));
                            }
                          }}
                        />
                        <Button 
                          size="icon" 
                          className="h-9 w-9 rounded-full shrink-0"
                          disabled={!commentInputs[notice.id]?.trim()}
                          onClick={() => {
                            addComment(notice.id, commentInputs[notice.id] || '');
                            setCommentInputs(prev => ({ ...prev, [notice.id]: '' }));
                          }}
                        >
                          <Send size={14} />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {notices.length === 0 && (
            <p className="text-center text-muted-foreground py-8">No notices yet. Start the conversation!</p>
          )}
        </div>

        {/* Create Post */}
        <Card className="rounded-3xl shadow-sm border-0 bg-card h-fit">
          <CardHeader>
            <CardTitle className="text-lg font-medium">New Post</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs value={type} onValueChange={(v) => setType(v as any)} className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-4 bg-muted/70 rounded-2xl p-1 shadow-inner border border-border/40 min-h-[44px] backdrop-blur-md">
                <TabsTrigger value="announcement" className="rounded-xl text-xs font-semibold data-active:shadow-md data-active:bg-background transition-all"><MessageSquare size={14} className="mr-1"/> Post</TabsTrigger>
                <TabsTrigger value="poll" className="rounded-xl text-xs font-semibold data-active:shadow-md data-active:bg-background transition-all"><BarChart2 size={14} className="mr-1"/> Poll</TabsTrigger>
              </TabsList>
              
              <div className="space-y-4">
                <textarea 
                  className="w-full min-h-[100px] p-3 rounded-xl border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder={type === 'poll' ? "Ask a question..." : "Share something with the flat..."}
                  value={content}
                  onChange={e => setContent(e.target.value)}
                />

                {type === 'poll' && (
                  <div className="space-y-2">
                    {options.map((opt, idx) => (
                      <Input 
                        key={idx}
                        placeholder={`Option ${idx + 1}`}
                        value={opt}
                        onChange={e => {
                          const newOpts = [...options];
                          newOpts[idx] = e.target.value;
                          setOptions(newOpts);
                        }}
                        className="h-9 text-sm"
                      />
                    ))}
                    {options.length < 5 && (
                      <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setOptions([...options, ''])}>
                        + Add Option
                      </Button>
                    )}
                  </div>
                )}

                <Button className="w-full rounded-full" onClick={postNotice} disabled={loading || !content}>
                  <Send size={16} className="mr-2" /> Post
                </Button>
              </div>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
