'use server'

import { client } from '@/lib/prisma'
import { currentUser } from '@clerk/nextjs/server'
import nodemailer from 'nodemailer';
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_CLIENT_SECRET as string)

export const sendEmail = async (
  to: string,
  subject: string,
  text: string,
  html?: string
) => {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.MAILER_EMAIL,
      pass: process.env.MAILER_PASSWORD,
    },
  })

  const mailOptions = {
    to,
    subject,
    text,
    html,
  }
  return { transporter, mailOptions }
}


export const onAuthenticateUser = async () => {
    try {
      const user = await currentUser()
      if (!user) {
        return { status: 403 }
      }
  
      const userExist = await client.user.findUnique({
        where: {
          clerkid: user.id,
        },
        include: {
          workspace: {
            where: {
              User: {
                clerkid: user.id,
              },
            },
          },
        },
      })
      if (userExist) {
        return { status: 200, user: userExist }
      }
      
      const newUser = await client.user.create({
        data: {
          clerkid: user.id,
          email: user.emailAddresses[0].emailAddress,
          firstname: user.firstName,
          lastname: user.lastName,
          image: user.imageUrl,
          studio: {
            create: {},
          },
          subscription: {
            create: {},
          },
          workspace: {
            create: {
              name: `${user.firstName}'s Workspace`,
              type: 'PERSONAL',
            },
          },
        },
        include: {
          workspace: {
            where: {
              User: {
                clerkid: user.id,
              },
            },
          },
          subscription: {
            select: {
              plan: true,
            },
          },
        },
      })
      if (newUser) {
        return { status: 201, user: newUser }
      }
      return { status: 400 }
    } catch (error) {
      console.log('🔴 ERROR', error)
      return { status: 500 }
    }
  }

  export const getNotifications = async () => {
    try {
      const user = await currentUser()
      if (!user) return { status: 404 }
      const notifications = await client.user.findUnique({
        where: {
          clerkid: user.id,
        },
        select: {
          notification: true,
          _count: {
            select: {
              notification: true,
            },
          },
        },
      })
  
      if (notifications && notifications.notification.length > 0)
        return { status: 200, data: notifications }
      return { status: 404, data: [] }
    } catch (error) {
      return { status: 400, data: [] }
    }
  }


  export const searchUsers = async (query: string) => {
    try {
      const user = await currentUser()
      if (!user) return { status: 404 }
  
      const users = await client.user.findMany({
        where: {
          OR: [
            { firstname: { contains: query } },
            { email: { contains: query } },
            { lastname: { contains: query } },
          ],
          NOT: [{ clerkid: user.id }],
        },
        select: {
          id: true,
          subscription: {
            select: {
              plan: true,
            },
          },
          firstname: true,
          lastname: true,
          image: true,
          email: true,
        },
      })
  
      if (users && users.length > 0) {
        return { status: 200, data: users }
      }
  
      return { status: 404, data: undefined }
    } catch (error) {
      return { status: 500, data: undefined }
    }
  }


  export const inviteMembers = async (
    workspaceId: string,
    recieverId: string,
    email: string
  ) => {
    try {
      const user = await currentUser()
      if (!user) return { status: 404 }
      const senderInfo = await client.user.findUnique({
        where: {
          clerkid: user.id,
        },
        select: {
          id: true,
          firstname: true,
          lastname: true,
        },
      })
      if (senderInfo?.id) {
        const workspace = await client.workSpace.findUnique({
          where: {
            id: workspaceId,
          },
          select: {
            name: true,
          },
        })
        if (workspace) {
          const invitation = await client.invite.create({
            data: {
              senderId: senderInfo.id,
              recieverId,
              workSpaceId: workspaceId,
              content: `You are invited to join ${workspace.name} Workspace, click accept to confirm`,
            },
            select: {
              id: true,
            },
          })
  
          await client.user.update({
            where: {
              clerkid: user.id,
            },
            data: {
              notification: {
                create: {
                  content: `${user.firstName} ${user.lastName} invited ${senderInfo.firstname} into ${workspace.name}`,
                },
              },
            },
          })
          if (invitation) {
            const { transporter, mailOptions } = await sendEmail(
              email,
              'You got an invitation',
              'You are invited to join ${workspace.name} Workspace, click accept to confirm',
              `<a href="${process.env.NEXT_PUBLIC_HOST_URL}/invite/${invitation.id}" style="background-color: #000; padding: 5px 10px; border-radius: 10px;">Accept Invite</a>`
            )
  
            transporter.sendMail(mailOptions, (error, info) => {
              if (error) {
                console.log('🔴', error.message)
              } else {
                console.log('✅ Email send')
              }
            })
            return { status: 200, data: 'Invite sent' }
          }
          return { status: 400, data: 'invitation failed' }
        }
        return { status: 404, data: 'workspace not found' }
      }
      return { status: 404, data: 'recipient not found' }
    } catch (error) {
      console.log(error)
      return { status: 400, data: 'Oops! something went wrong' }
    }
  }