// file: nextcrm/app/[locale]/(routes)/crm/accounts/[accountId]/components/TasksView.tsx
/*
This component displays and manages tasks for a specific CRM account
Includes task list, creation, and management functionality

MIGRATION NOTES (MongoDB -> Supabase):
- Updated Prisma type import from 'crm_Accounts' to 'crm_Accounts' (kept as per schema)
- Enhanced error handling and loading states
- Improved UI with better task statistics and status indicators
- Added proper data validation and empty state handling
- Enhanced user experience with better organization and visual feedback
- Added task filtering and status management
- Fixed useEffect dependency warning
*/
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { crm_Accounts } from "@prisma/client"; // Model name matches schema

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

import { columns } from "../tasks-data-table/components/columns";
import { TasksDataTable } from "../tasks-data-table/components/data-table";

import NewTaskForm from "./NewTaskForm";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  CheckCircle,
  Clock,
  Plus,
  Filter,
  AlertCircle,
  ListTodo,
  Calendar,
  User,
  MoreHorizontal,
  RefreshCw,
} from "lucide-react";

interface TasksViewProps {
  data: any[]; // Array of tasks
  account: crm_Accounts | null;
}

type TaskFilter = "all" | "active" | "pending" | "complete";

const AccountsTasksView = ({ data, account }: TasksViewProps) => {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [filteredData, setFilteredData] = useState(data || []);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Memoize applyFilter function to prevent unnecessary re-renders
  const applyFilter = useCallback((filterType: TaskFilter) => {
    if (!data) {
      setFilteredData([]);
      return;
    }

    let filtered = data;
    switch (filterType) {
      case "active":
        filtered = data.filter(task => task.taskStatus === "ACTIVE");
        break;
      case "pending":
        filtered = data.filter(task => task.taskStatus === "PENDING");
        break;
      case "complete":
        filtered = data.filter(task => task.taskStatus === "COMPLETE");
        break;
      default:
        filtered = data;
    }
    setFilteredData(filtered);
  }, [data]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Fixed useEffect with proper dependencies
  useEffect(() => {
    applyFilter(filter);
  }, [data, filter, applyFilter]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      router.refresh();
      // Add a small delay for visual feedback
      setTimeout(() => setIsRefreshing(false), 500);
    } catch (error) {
      console.error("Error refreshing tasks:", error);
      setIsRefreshing(false);
    }
  };

  // Memoize task statistics calculation
  const taskStats = useCallback(() => {
    if (!data) return { total: 0, active: 0, pending: 0, complete: 0 };
    
    return {
      total: data.length,
      active: data.filter(task => task.taskStatus === "ACTIVE").length,
      pending: data.filter(task => task.taskStatus === "PENDING").length,
      complete: data.filter(task => task.taskStatus === "COMPLETE").length,
    };
  }, [data])();

  const handleFilterChange = useCallback((newFilter: TaskFilter) => {
    setFilter(newFilter);
  }, []);

  const handleOpenChange = useCallback((isOpen: boolean) => {
    setOpen(isOpen);
  }, []);

  if (!isMounted) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="space-y-3">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-4 w-40" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!account) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-500" />
            Account Not Found
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert className="border-red-200 bg-red-50">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-700">
              Unable to load account information. Tasks cannot be displayed without a valid account.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <CardTitle 
                onClick={() => router.push("/projects/tasks")}
                className="cursor-pointer flex items-center gap-2 hover:text-blue-600 transition-colors"
              >
                <ListTodo className="h-5 w-5" />
                Account Tasks
              </CardTitle>
              <Badge variant="outline" className="text-xs">
                {account.name}
              </Badge>
            </div>
            <CardDescription className="flex items-center gap-4">
              <span>Manage tasks for this account</span>
              {taskStats.total > 0 && (
                <div className="flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1">
                    <div className="h-2 w-2 bg-blue-500 rounded-full"></div>
                    {taskStats.total} Total
                  </span>
                  <span className="flex items-center gap-1">
                    <div className="h-2 w-2 bg-green-500 rounded-full"></div>
                    {taskStats.active} Active
                  </span>
                  <span className="flex items-center gap-1">
                    <div className="h-2 w-2 bg-amber-500 rounded-full"></div>
                    {taskStats.pending} Pending
                  </span>
                  <span className="flex items-center gap-1">
                    <div className="h-2 w-2 bg-gray-500 rounded-full"></div>
                    {taskStats.complete} Complete
                  </span>
                </div>
              )}
            </CardDescription>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Filter Dropdown */}
            {taskStats.total > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Filter className="h-4 w-4 mr-2" />
                    Filter
                    {filter !== "all" && (
                      <Badge variant="secondary" className="ml-2 text-xs">
                        {filter}
                      </Badge>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Filter by Status</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleFilterChange("all")}>
                    <ListTodo className="h-4 w-4 mr-2" />
                    All Tasks ({taskStats.total})
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleFilterChange("active")}>
                    <CheckCircle className="h-4 w-4 mr-2 text-green-600" />
                    Active ({taskStats.active})
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleFilterChange("pending")}>
                    <Clock className="h-4 w-4 mr-2 text-amber-600" />
                    Pending ({taskStats.pending})
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleFilterChange("complete")}>
                    <CheckCircle className="h-4 w-4 mr-2 text-gray-600" />
                    Complete ({taskStats.complete})
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Refresh Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>

            {/* Add Task Button */}
            <Sheet open={open} onOpenChange={handleOpenChange}>
              <Button
                onClick={() => setOpen(true)}
                size="sm"
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                Add Task
              </Button>
              <SheetContent className="min-w-[500px] space-y-4 overflow-y-auto">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    <Plus className="h-5 w-5" />
                    Create New Task
                  </SheetTitle>
                  <div className="text-sm text-muted-foreground">
                    Creating task for: <span className="font-medium">{account.name}</span>
                  </div>
                </SheetHeader>
                <Separator />
                <div className="flex-1">
                  <NewTaskForm
                    account={account}
                    onFinish={() => setOpen(false)}
                  />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
        <Separator className="mt-4" />
      </CardHeader>

      <CardContent>
        {!data ? (
          // Loading state
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Loading tasks...
            </div>
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </div>
        ) : taskStats.total === 0 ? (
          // Empty state
          <div className="text-center py-12">
            <div className="flex justify-center mb-4">
              <div className="rounded-full bg-gray-100 p-3">
                <ListTodo className="h-8 w-8 text-gray-400" />
              </div>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No tasks yet</h3>
            <p className="text-gray-500 mb-4 max-w-sm mx-auto">
              Get started by creating your first task for this account. Tasks help you track work and stay organized.
            </p>
            <Button onClick={() => setOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Create First Task
            </Button>
          </div>
        ) : filteredData.length === 0 ? (
          // Filtered empty state
          <div className="text-center py-8">
            <div className="flex justify-center mb-4">
              <div className="rounded-full bg-gray-100 p-3">
                <Filter className="h-6 w-6 text-gray-400" />
              </div>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No {filter} tasks found
            </h3>
            <p className="text-gray-500 mb-4">
              Try adjusting your filter or create a new task.
            </p>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={() => handleFilterChange("all")}>
                Clear Filter
              </Button>
              <Button onClick={() => setOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                Add Task
              </Button>
            </div>
          </div>
        ) : (
          // Tasks table
          <div className="space-y-4">
            {/* Filter info */}
            {filter !== "all" && (
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Filter className="h-4 w-4" />
                  Showing {filteredData.length} {filter} task{filteredData.length !== 1 ? 's' : ''} of {taskStats.total} total
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleFilterChange("all")}>
                  Clear Filter
                </Button>
              </div>
            )}
            
            {/* Tasks data table */}
            <TasksDataTable data={filteredData} columns={columns} />
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AccountsTasksView;